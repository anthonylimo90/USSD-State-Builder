const { createHash, randomUUID } = require('node:crypto');
const TurnBudget = require('./TurnBudget');
const { ProviderRequestError } = require('./AfricasTalkingAdapter');
function ledgerOf(record) {
  const { session, now, activeExpiresAt, receiptExpiresAt, closed, ...ledger } = record;
  return ledger;
}
class TurnGateway {
  constructor({ adapter, machine, store, receiptTTL = 86400, maxTurns = 128, maxRecordBytes = 1048576, sessionData, recoverTurn, eventStore, deadlineMs = 5000, leaseMs = deadlineMs, ownershipCheckMs = 100 }) {
    if (!adapter?.bindSession || !machine?.prepareTurn || !['read', 'claim', 'commit'].every(method => typeof store?.[method] === 'function') || store.storage !== machine.storage || store.supportsDeadlines !== true ||
        (eventStore && (eventStore.storage !== machine.storage || typeof eventStore.read !== 'function'))) {
      throw new TypeError('TurnGateway requires an adapter, preparable machine and deadline-capable atomic store sharing storage');
    }
    const timeouts = [machine.timeout, ...[...machine._previousFlows.values()].map(flow => flow.timeout)];
    if (!Number.isSafeInteger(receiptTTL) || receiptTTL < Math.max(...timeouts) || receiptTTL > 2147483647 ||
        ![deadlineMs, leaseMs, ownershipCheckMs].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 2147483647) ||
        !Number.isSafeInteger(maxTurns) || maxTurns < 1 || !Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1024) {
      throw new TypeError('Invalid receipt bounds; retention must cover every retained flow timeout');
    }
    Object.assign(this, { adapter, machine, store, receiptTTL, maxTurns, maxRecordBytes, sessionData, recoverTurn, eventStore, deadlineMs, leaseMs, ownershipCheckMs });
  }
  async handle(request, options) {
    try { return await this.process(this.adapter.normalize(request), options); }
    catch (error) { return this.adapter.errorResponse(error); }
  }
  _identity(turn) {
    return createHash('sha256').update(JSON.stringify([turn.sessionKey, turn.position, turn.transcript])).digest('hex');
  }
  _bounded(value) {
    if (Buffer.byteLength(JSON.stringify(value)) > this.maxRecordBytes) throw new ProviderRequestError('RECEIPT_LIMIT', 409);
  }
  async process(turn, options = {}, recovering = false) {
    const budget = new TurnBudget(this.deadlineMs, options);
    let monitor;
    try { return await this._process(turn, recovering, budget, callback => { clearInterval(monitor); monitor = callback; }); }
    catch (error) { budget.abort('TURN_FAILED'); throw error; }
    finally { clearInterval(monitor); budget.close(); }
  }
  async _process(turn, recovering, budget, setMonitor) {
    const fingerprint = this._identity(turn);
    const observed = await budget.run(() => this.store.read(turn.sessionKey, { withClock: true }));
    budget.anchorStore(observed.now);
    const record = observed.empty ? null : observed;
    if (record?.orphan) throw new ProviderRequestError('UNBOUND_SESSION', 409);
    const binding = this.adapter.bindSession(turn, record?.binding);
    const receipt = record?.receipts.find(item => item.fingerprint === fingerprint);
    if (receipt) return JSON.parse(JSON.stringify(receipt.response));
    if (!recovering && (record?.closed || (this.eventStore && await budget.run(() => this.eventStore.read(turn.sessionKey))))) {
      throw new ProviderRequestError('PROVIDER_SESSION_CLOSED', 409);
    }
    if (record?.pending) {
      if (!recovering || !this.recoverTurn || record.pending.fingerprint !== fingerprint) throw new ProviderRequestError('UNCERTAIN_TURN', 503);
    } else {
      if (recovering) throw new ProviderRequestError('NO_PENDING_TURN', 409);
      const relation = this.adapter.compareTranscript(turn, record?.transcript);
      if (!['initial', 'next'].includes(relation) || record?.completed ||
          (record && record.activeExpiresAt <= record.now)) throw new ProviderRequestError('TRANSCRIPT_CONFLICT', 409);
    }
    if ((record?.receipts.length || 0) >= this.maxTurns) throw new ProviderRequestError('RECEIPT_LIMIT', 409);
    const seedData = !recovering && this.sessionData ? await budget.run(() => this.sessionData(turn, { signal: budget.signal, deadlineAt: budget.deadlineAt })) : undefined;
    const revision = record?.revision || 0;
    const pending = { token: randomUUID(), fingerprint, position: turn.position,
      idempotencyKey: `ussd-turn:${fingerprint}`, revision, kind: recovering ? 'recovery' : 'turn', flowVersion: recovering ? record.pending.flowVersion : record?.session?.data?.__ussdFlow?.version || this.machine.flowVersion };
    const ledger = record ? ledgerOf(record) : { schemaVersion: 1, revision, binding, transcript: null, receipts: [], completed: false };
    const claimed = { ...ledger, pending };
    this._bounded(claimed);
    budget.shorten(this.leaseMs);
    if (!await budget.run(() => this.store.claim(turn.sessionKey, revision, claimed, this.receiptTTL,
      recovering ? record.pending.token : null, Math.max(1, budget.remaining()), budget.storeDeadline()))) {
      // A competing commit may already have installed the exact response.
      const latest = await budget.run(() => this.store.read(turn.sessionKey));
      this.adapter.bindSession(turn, latest?.binding);
      const replay = latest?.receipts?.find(item => item.fingerprint === fingerprint);
      if (replay) return JSON.parse(JSON.stringify(replay.response));
      throw new ProviderRequestError('TURN_IN_PROGRESS', 503);
    }
    let checking = false;
    setMonitor(setInterval(async () => {
      if (checking || budget.signal.aborted) return;
      checking = true;
      try {
        const latest = await budget.run(() => this.store.read(turn.sessionKey));
        if (latest?.pending?.token !== pending.token || latest.revision !== revision || (!recovering && latest.closed)) budget.abort('TURN_OWNERSHIP_LOST');
      } catch { budget.abort('TURN_OWNERSHIP_UNKNOWN'); }
      finally { checking = false; }
    }, this.ownershipCheckMs));
    let prepared;
    if (recovering) {
      prepared = await budget.run(() => this.recoverTurn({ turn, pending: record.pending, session: record.session, revision, signal: budget.signal, deadlineAt: budget.deadlineAt }));
      if (!prepared) throw new ProviderRequestError('UNRESOLVED_EFFECT', 503);
    } else {
      const remaining = record ? record.activeExpiresAt - record.now : null;
      const session = record?.session ? { ...record.session, expiresAt: Date.now() + remaining } : null;
      prepared = await budget.run(() => this.machine.prepareTurn(turn.sessionKey, turn.input, { session,
        sessionData: seedData,
        signal: budget.signal, deadlineAt: budget.deadlineAt,
        turn: { idempotencyKey: pending.idempotencyKey, position: turn.position, revision } }));
    }
    const response = this.adapter.formatResponse(prepared.response, { ...prepared, turn });
    if (recovering && prepared.session) {
      const data = { ...prepared.session.data };
      if (pending.flowVersion) data.__ussdFlow = { version: pending.flowVersion };
      if (response.body.startsWith('END ')) {
        data.__ussdLifecycle = { completedResponse: response.body, completedAt: Date.now() };
      }
      prepared = { ...prepared, session: { ...prepared.session, data } };
    }
    const committed = { ...ledger, pending: null, revision: revision + 1, transcript: turn.transcript,
      completed: response.body.startsWith('END '), receipts: [...ledger.receipts, { fingerprint, position: turn.position, response }] };
    this._bounded({ ...committed, session: prepared.session });
    const activeMs = prepared.session?.expiresAt ? Math.max(1, prepared.session.expiresAt - Date.now()) : this.machine.timeout * 1000;
    if (activeMs > this.receiptTTL * 1000) throw new ProviderRequestError('INVALID_RECOVERY_EXPIRY', 500);
    budget.check();
    if (!await budget.run(() => this.store.commit(turn.sessionKey, revision, pending.token, committed, prepared.session, this.receiptTTL, Math.ceil(activeMs)))) {
      throw new ProviderRequestError('STALE_TURN_OWNER', 503);
    }
    // Release ownership monitoring before notifications: the pending token is gone.
    setMonitor(null);
    try { await budget.run(() => prepared.notify?.()); }
    catch (error) {
      try { this.machine.logger?.error?.('Error in committed turn notification:', error); } catch { /* The receipt is already durable. */ }
    }
    return response;
  }
  async recover(request, options) {
    try { return await this.process(this.adapter.normalize(request), options, true); }
    catch (error) { return this.adapter.errorResponse(error); }
  }
}
module.exports = { TurnGateway };
