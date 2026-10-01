const { createMetricEvent, aggregateMetricEvents } = require('./MetricEvents');
const { buildMetricReport } = require('./MetricReporting');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const STATE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const bound = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
function roster(values, pattern, max) {
  if (!Array.isArray(values) || values.length > max || values.some(value => typeof value !== 'string' || !pattern.test(value) || UUID.test(value) || /^\+?\d{7,15}$/.test(value))) {
    throw new TypeError('Metric labels require a bounded authored allowlist');
  }
  return new Set(values);
}

/** In-process telemetry only. No background queue, durable store or external deletion guarantee. */
class MetricEventBuffer {
  constructor({ flowVersions, states, retentionMs = 3600000, maxEvents = 10000, maxBytes = 8388608,
    maxSessions = 1000, maxTombstones = 4096, exportTimeoutMs = 5000, maxFutureSkewMs = 0,
    inactivityMs = null, now = Date.now, exporter, onFailure } = {}) {
    this.flowVersions = roster(flowVersions, VERSION, 128);
    this.states = roster(states, STATE, 1024);
    if (!bound(retentionMs, 1, 31536000000) || !bound(maxEvents, 1, 100000) || !bound(maxBytes, 2048, 67108864) ||
        !bound(maxSessions, 1, 100000) || !bound(maxTombstones, 1, 100000) || !bound(exportTimeoutMs, 1, 60000) ||
        !bound(maxFutureSkewMs, 0, 60000) || (inactivityMs !== null && !bound(inactivityMs, 1, 2147483647)) ||
        typeof now !== 'function' || (exporter !== undefined && typeof exporter !== 'function') ||
        (onFailure !== undefined && typeof onFailure !== 'function')) throw new TypeError('Invalid metric buffer controls');
    Object.assign(this, { retentionMs, maxEvents, maxBytes, maxSessions, maxTombstones, exportTimeoutMs,
      maxFutureSkewMs, inactivityMs, now, exporter, onFailure });
    this._events = new Map(); this._sessions = new Map(); this._tombstones = new Map();
    this._bytes = 0; this._generation = 0; this._closed = false; this._sealed = false; this._active = null; this._lastNow = 0;
    this._counts = { accepted: 0, duplicates: 0, invalid: 0, labels: 0, expired: 0, future: 0,
      capacity: 0, denied: 0, rejectedClosed: 0, failures: 0, exports: 0, timeouts: 0, evictedEvents: 0, deletedEvents: 0 };
  }
  _time() {
    const value = this.now();
    if (!bound(value, 0, 8640000000000000)) throw new TypeError('Invalid metric clock');
    this._lastNow = Math.max(this._lastNow, value); // Clock regression cannot revive expired data.
    return this._lastNow;
  }
  _failure(code) {
    this._counts.failures++;
    try {
      const result = this.onFailure?.(Object.freeze({ code }));
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
    } catch { /* Telemetry failure callbacks are isolated from the application. */ }
  }
  _invalidate() {
    this._generation++;
    this._active?.controller.abort();
    this._active?.invalidate();
  }
  _remove(sessionId) {
    let removed = 0;
    for (const [eventId, value] of this._events) if (value.event.sessionId === sessionId) {
      this._events.delete(eventId); this._bytes -= value.bytes; removed++;
    }
    this._sessions.delete(sessionId);
    return removed;
  }
  _deny(sessionId, until) {
    if (this._tombstones.has(sessionId) || this._tombstones.size < this.maxTombstones) this._tombstones.set(sessionId, until);
    else { this._sealed = true; this._failure('tombstone_capacity'); }
  }
  _prune(time) {
    for (const [id, until] of this._tombstones) if (until !== null && until <= time) this._tombstones.delete(id);
    let removed = 0;
    for (const [id, anchor] of this._sessions) if (anchor + this.retentionMs <= time) {
      removed += this._remove(id); this._deny(id, time + this.retentionMs);
    }
    if (removed) { this._counts.evictedEvents += removed; this._invalidate(); }
  }
  record(source) {
    const reject = reason => { this._counts[reason === 'closed' ? 'rejectedClosed' : reason]++; return { accepted: false, reason }; };
    if (this._closed) return reject('closed');
    try {
      const time = this._time(); this._prune(time);
      if (this._sealed) return reject('capacity');
      const event = createMetricEvent(source);
      if ((event.flowVersion !== null && !this.flowVersions.has(event.flowVersion)) ||
          (event.eventType === 'turn' && ['previousState', 'nextState'].some(field => event[field] !== null && !this.states.has(event[field])))) return reject('labels');
      if (this._tombstones.has(event.sessionId)) return reject('denied');
      const at = Date.parse(event.occurredAt);
      if (at > time + this.maxFutureSkewMs) return reject('future');
      if (at + this.retentionMs <= time) return reject('expired');
      const json = JSON.stringify(event), existing = this._events.get(event.eventId);
      if (existing) {
        if (existing.json !== json) return reject('invalid');
        this._counts.duplicates++; return { accepted: true, duplicate: true };
      }
      const bytes = Buffer.byteLength(json);
      if (this._events.size >= this.maxEvents || this._bytes + bytes > this.maxBytes ||
          (!this._sessions.has(event.sessionId) && this._sessions.size >= this.maxSessions)) return reject('capacity');
      // Conservative group budgets include a possible unknown exit for every started cohort.
      const versions = new Set(), groups = new Set();
      for (const item of [...this._events.values()].map(value => value.event).concat(event)) {
        versions.add(item.flowVersion);
        if (item.eventType === 'session_start') groups.add(JSON.stringify([item.flowVersion, null]));
        if (item.eventType === 'turn') for (const state of [item.previousState, item.nextState]) groups.add(JSON.stringify([item.flowVersion, state]));
      }
      if (versions.size > 128 || groups.size > 1024) return reject('capacity');
      // Validate the affected cohort and any globally shared logical identifiers before retaining it.
      const logical = ['requestId', 'turnId', 'businessId'].find(field => event[field]);
      const related = [...this._events.values()].map(value => value.event).filter(value =>
        value.sessionId === event.sessionId || (logical && value[logical] === event[logical]));
      aggregateMetricEvents([...related, event], { asOf: new Date(time + this.maxFutureSkewMs).toISOString(), inactivityMs: this.inactivityMs });
      this._events.set(event.eventId, { event, json, bytes }); this._bytes += bytes;
      this._sessions.set(event.sessionId, Math.min(this._sessions.get(event.sessionId) ?? at, at));
      this._counts.accepted++;
      return { accepted: true, duplicate: false };
    } catch { this._failure('record_invalid'); return reject('invalid'); }
  }
  snapshot() {
    if (this._closed) throw new Error('Metric buffer is closed');
    const time = this._time(); this._prune(time);
    const events = Object.freeze([...this._events.values()].map(value => value.event));
    const options = Object.freeze({ asOf: new Date(time).toISOString(), inactivityMs: this.inactivityMs });
    return Object.freeze({ generation: this._generation, events, options, report: buildMetricReport(events, options) });
  }
  stats() {
    if (!this._closed) this._prune(this._time());
    return { ...this._counts, events: this._events.size, bytes: this._bytes, sessions: this._sessions.size,
      tombstones: this._tombstones.size, generation: this._generation, exportInFlight: Boolean(this._active),
      closed: this._closed, ingestionPaused: this._sealed };
  }
  deleteSession(sessionId) {
    if (typeof sessionId !== 'string' || !UUID.test(sessionId)) throw new TypeError('Deletion requires a pseudonymous session UUID');
    if (this._closed) return { deletedEvents: 0, closed: true };
    this._prune(this._time());
    sessionId = sessionId.toLowerCase();
    const deletedEvents = this._remove(sessionId);
    this._deny(sessionId, null); // Explicit deletion remains denied for this buffer's lifetime.
    this._counts.deletedEvents += deletedEvents; this._invalidate();
    return { deletedEvents, ingestionPaused: this._sealed };
  }
  clear() {
    if (this._closed) return;
    this._counts.deletedEvents += this._events.size;
    this._events.clear(); this._sessions.clear(); this._tombstones.clear(); this._bytes = 0;
    this._sealed = true; this._invalidate(); // Erase all local evidence and deny future ingestion.
  }
  close() {
    if (this._closed) return;
    this.clear(); this._closed = true;
  }
  async flush() {
    if (this._closed) return { status: 'closed' };
    try { this._prune(this._time()); } catch { this._failure('clock_invalid'); return { status: 'failed', code: 'clock_invalid' }; }
    if (this._active) return { status: 'busy' };
    if (!this.exporter) return { status: 'no_exporter' };
    let snapshot;
    try { snapshot = this.snapshot(); } catch { this._failure('snapshot_invalid'); return { status: 'failed', code: 'snapshot_invalid' }; }
    const controller = new AbortController();
    let timer, invalidated;
    const invalidation = new Promise(resolve => { invalidated = resolve; });
    const active = { controller, invalidate: () => invalidated({ status: 'invalidated' }) };
    this._active = active;
    const isCurrent = () => {
      try { this._prune(this._time()); } catch { controller.abort(); }
      return !controller.signal.aborted && !this._closed && snapshot.generation === this._generation;
    };
    // One physical export owns the slot even if its public deadline has elapsed.
    const work = Promise.resolve().then(() => {
      if (!isCurrent()) return { status: 'invalidated' };
      return this.exporter(snapshot, Object.freeze({ signal: controller.signal, isCurrent }));
    }).then(() => {
      if (!isCurrent()) return { status: 'invalidated' };
      this._counts.exports++; return { status: 'exported' };
    }, () => { this._failure('export_failed'); return { status: 'failed', code: 'export_failed' }; })
      .finally(() => { clearTimeout(timer); if (this._active === active) this._active = null; });
    const deadline = new Promise(resolve => {
      timer = setTimeout(() => {
        this._counts.timeouts++; this._failure('export_timeout'); controller.abort();
        resolve({ status: 'timeout' });
      }, this.exportTimeoutMs);
    });
    const result = await Promise.race([work, deadline, invalidation]);
    clearTimeout(timer);
    return result;
  }
}
module.exports = { MetricEventBuffer };
