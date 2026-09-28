const { createHash, randomUUID } = require('node:crypto');
const { ProviderRequestError } = require('./AfricasTalkingAdapter');
function ledgerOf(record) {
  const { session, now, activeExpiresAt, receiptExpiresAt, ...ledger } = record;
  return ledger;
}
class TurnGateway {
  constructor({ adapter, machine, store, receiptTTL = 86400, maxTurns = 128, maxRecordBytes = 1048576, sessionData, recoverTurn }) {
    if (!adapter?.bindSession || !machine?.prepareTurn || !['read', 'claim', 'commit'].every(method => typeof store?.[method] === 'function') || store.storage !== machine.storage) {
      throw new TypeError('TurnGateway requires an adapter, preparable machine and atomic store sharing storage');
    }
    const timeouts = [machine.timeout, ...[...machine._previousFlows.values()].map(flow => flow.timeout)];
    if (!Number.isSafeInteger(receiptTTL) || receiptTTL < Math.max(...timeouts) || receiptTTL > 2147483647 ||
        !Number.isSafeInteger(maxTurns) || maxTurns < 1 || !Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1024) {
      throw new TypeError('Invalid receipt bounds; retention must cover every retained flow timeout');
    }
    Object.assign(this, { adapter, machine, store, receiptTTL, maxTurns, maxRecordBytes, sessionData, recoverTurn });
  }
  async handle(request) {
    try { return await this.process(this.adapter.normalize(request)); }
    catch (error) { return this.adapter.errorResponse(error); }
  }
  _identity(turn) {
    return createHash('sha256').update(JSON.stringify([turn.sessionKey, turn.position, turn.transcript])).digest('hex');
  }
  _bounded(value) {
    if (Buffer.byteLength(JSON.stringify(value)) > this.maxRecordBytes) throw new ProviderRequestError('RECEIPT_LIMIT', 409);
  }
  async process(turn, recovering = false) {
    const fingerprint = this._identity(turn);
    const record = await this.store.read(turn.sessionKey);
    if (record?.orphan) throw new ProviderRequestError('UNBOUND_SESSION', 409);
    const binding = this.adapter.bindSession(turn, record?.binding);
    const receipt = record?.receipts.find(item => item.fingerprint === fingerprint);
    if (receipt) return JSON.parse(JSON.stringify(receipt.response));
    if (record?.pending) {
      if (!recovering || !this.recoverTurn || record.pending.fingerprint !== fingerprint) throw new ProviderRequestError('UNCERTAIN_TURN', 503);
    } else {
      if (recovering) throw new ProviderRequestError('NO_PENDING_TURN', 409);
      const relation = this.adapter.compareTranscript(turn, record?.transcript);
      if (!['initial', 'next'].includes(relation) || record?.completed ||
          (record && record.activeExpiresAt <= record.now)) throw new ProviderRequestError('TRANSCRIPT_CONFLICT', 409);
    }
    if ((record?.receipts.length || 0) >= this.maxTurns) throw new ProviderRequestError('RECEIPT_LIMIT', 409);
    const seedData = !recovering && this.sessionData ? await this.sessionData(turn) : undefined;
    const revision = record?.revision || 0;
    const pending = { token: randomUUID(), fingerprint, position: turn.position,
      idempotencyKey: `ussd-turn:${fingerprint}`, revision, flowVersion: recovering ? record.pending.flowVersion : record?.session?.data?.__ussdFlow?.version || this.machine.flowVersion };
    const ledger = record ? ledgerOf(record) : { schemaVersion: 1, revision, binding, transcript: null, receipts: [], completed: false };
    const claimed = { ...ledger, pending };
    this._bounded(claimed);
    if (!await this.store.claim(turn.sessionKey, revision, claimed, this.receiptTTL, recovering ? record.pending.token : null)) {
      // A competing commit may already have installed the exact response.
      const latest = await this.store.read(turn.sessionKey);
      this.adapter.bindSession(turn, latest?.binding);
      const replay = latest?.receipts?.find(item => item.fingerprint === fingerprint);
      if (replay) return JSON.parse(JSON.stringify(replay.response));
      throw new ProviderRequestError('TURN_IN_PROGRESS', 503);
    }
    let prepared;
    if (recovering) {
      prepared = await this.recoverTurn({ turn, pending: record.pending, session: record.session, revision });
      if (!prepared) throw new ProviderRequestError('UNRESOLVED_EFFECT', 503);
    } else {
      const remaining = record ? record.activeExpiresAt - record.now : null;
      const session = record?.session ? { ...record.session, expiresAt: Date.now() + remaining } : null;
      prepared = await this.machine.prepareTurn(turn.sessionKey, turn.input, { session,
        sessionData: seedData,
        turn: { idempotencyKey: pending.idempotencyKey, position: turn.position, revision } });
    }
    const response = this.adapter.formatResponse(prepared.response, prepared);
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
    if (!await this.store.commit(turn.sessionKey, revision, pending.token, committed, prepared.session, this.receiptTTL, Math.ceil(activeMs))) {
      throw new ProviderRequestError('STALE_TURN_OWNER', 503);
    }
    try { await prepared.notify?.(); }
    catch (error) {
      try { this.machine.logger?.error?.('Error in committed turn notification:', error); } catch { /* The receipt is already durable. */ }
    }
    return response;
  }
  async recover(request) {
    try { return await this.process(this.adapter.normalize(request), true); }
    catch (error) { return this.adapter.errorResponse(error); }
  }
}
module.exports = { TurnGateway };
