const { performance } = require('node:perf_hooks');
const { ProviderRequestError } = require('./AfricasTalkingAdapter');

// Racing bounds the response; the signal requests real cooperative cancellation.
// Store-side ownership/deadline checks are still required for durable writes.
class TurnBudget {
  constructor(timeoutMs, { signal, deadlineAt } = {}) {
    if (deadlineAt !== undefined && (!Number.isFinite(deadlineAt) || deadlineAt <= 0)) throw new TypeError('Invalid request deadline');
    if (signal && typeof signal.addEventListener !== 'function') throw new TypeError('Invalid abort signal');
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.onAbort = () => this.abort('REQUEST_ABORTED');
    this.parent = signal;
    signal?.addEventListener('abort', this.onAbort, { once: true });
    this.end = performance.now() + Math.min(timeoutMs, deadlineAt === undefined ? timeoutMs : Math.max(0, deadlineAt - Date.now()));
    this.arm();
    if (signal?.aborted) this.onAbort();
  }
  arm() {
    clearTimeout(this.timer);
    this.deadlineAt = Date.now() + this.remaining();
    this.timer = setTimeout(() => this.abort('TURN_DEADLINE'), Math.max(1, this.remaining()));
  }
  anchorStore(now) { this.storeClock = { now, at: performance.now() }; }
  storeDeadline() { return Math.floor(this.storeClock.now + this.end - this.storeClock.at); }
  remaining() { return Math.max(0, Math.ceil(this.end - performance.now())); }
  shorten(ms) { this.end = Math.min(this.end, performance.now() + ms); this.arm(); }
  abort(code) { if (!this.signal.aborted) this.controller.abort(new ProviderRequestError(code, 503)); }
  check() {
    if (!this.remaining()) this.abort('TURN_DEADLINE');
    this.signal.throwIfAborted();
  }
  async run(task) {
    this.check();
    let listener;
    const aborted = new Promise((resolve, reject) => {
      listener = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', listener, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(() => { this.check(); return task(); }), aborted]); }
    finally { this.signal.removeEventListener('abort', listener); }
  }
  close() { clearTimeout(this.timer); this.parent?.removeEventListener('abort', this.onAbort); }
}
module.exports = TurnBudget;
