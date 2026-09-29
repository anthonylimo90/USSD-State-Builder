const { randomUUID } = require('node:crypto');
const { createTraceObserver, createTraceEvent } = require('./TraceSchema');
const { StateInspector } = require('./StateInspector');
const { USSDSimulator } = require('./USSDSimulator');
const { USSDTester } = require('./TestingUtils');

class WorkbenchError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function limit(value, fallback, maximum) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new TypeError('Invalid workbench limit');
  return result;
}

// Only explicitly public, small scalar values enter the inspector. Internal data
// and fields marked sensitive/secret anywhere in the flow always stay hidden.
function publicData(definition, data = {}) {
  const fields = new Map();
  for (const state of Object.values(definition.states)) {
    if (!state.field) continue;
    const { name, sensitivity } = state.field;
    fields.set(name, fields.get(name) === false ? false : sensitivity === 'public');
  }
  const visible = Object.create(null);
  let hiddenFields = 0;
  for (const [key, value] of Object.entries(data || {})) {
    if (key.startsWith('__ussd')) continue;
    const scalar = value === null || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && Buffer.byteLength(value) <= 256);
    if (fields.get(key) === true && scalar && Buffer.byteLength(JSON.stringify(visible)) +
        Buffer.byteLength(JSON.stringify({ [key]: value })) <= 4096) visible[key] = value;
    else hiddenFields++;
  }
  return { values: visible, hiddenFields };
}

/** Local synthetic-flow controller. Each session gets a fresh application instance. */
class LocalWorkbench {
  constructor({ flows, maxSessions, maxHistory } = {}) {
    if (!Array.isArray(flows) || !flows.length || flows.length > 16) throw new TypeError('Workbench needs 1–16 flow factories');
    this.flows = new Map();
    for (const flow of flows) {
      if (!flow || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(flow.id) || this.flows.has(flow.id) ||
          typeof flow.name !== 'string' || !flow.name.trim() || flow.name.length > 80 ||
          typeof flow.createMachine !== 'function') throw new TypeError('Invalid workbench flow factory');
      this.flows.set(flow.id, { ...flow });
    }
    this.maxSessions = limit(maxSessions, 8, 16);
    this.maxHistory = limit(maxHistory, 64, 256);
    this.sessions = new Map();
    this.usedMachines = new WeakSet();
    this.closed = false;
  }

  describe() {
    return { flows: [...this.flows.values()].map(({ id, name }) => ({ id, name })),
      maxSessions: this.maxSessions, maxHistory: this.maxHistory };
  }

  _record(id) {
    if (this.closed) throw new WorkbenchError('WORKBENCH_CLOSED', 503);
    const record = this.sessions.get(id);
    if (!record || !record.machine) throw new WorkbenchError('SESSION_NOT_FOUND', 404);
    return record;
  }

  async _install(record) {
    const sessionId = `workbench_${randomUUID()}`;
    const machine = await this.flows.get(record.flowId).createMachine({ sessionId });
    if (!machine || typeof machine.processInput !== 'function' || typeof machine.getFlowDefinition !== 'function' ||
        typeof machine.useTurnObserver !== 'function' || typeof machine.storage?.getSession !== 'function' ||
        this.usedMachines.has(machine)) throw new TypeError('Flow factory must return a fresh state machine with session storage');
    const definition = machine.getFlowDefinition();
    if (Buffer.byteLength(JSON.stringify(definition)) > 32768) throw new TypeError('Workbench flow metadata exceeds byte limit');
    // Validate static metadata against the shared trace contract before starting.
    for (const state of Object.keys(definition.states)) createTraceEvent({ flowVersion: definition.flowVersion,
      requestId: randomUUID(), turnId: randomUUID(), previousState: state, nextState: state,
      outcome: 'success', durationMs: 0 });
    this.usedMachines.add(machine);
    Object.assign(record, { machine, sessionId, definition, analysis: require('./FlowAnalysis').analyzeFlowDefinition(definition), history: [], totalTurns: 0, response: null, failure: null, hadSession: false });
    machine.useTurnObserver(createTraceObserver(event => {
      record.history.push(event);
      if (record.history.length > this.maxHistory) record.history.shift();
      record.totalTurns++;
    }));
  }

  async createSession(flowId = this.flows.keys().next().value) {
    if (this.closed) throw new WorkbenchError('WORKBENCH_CLOSED', 503);
    if (!this.flows.has(flowId)) throw new WorkbenchError('FLOW_NOT_FOUND', 404);
    if (this.sessions.size >= this.maxSessions) throw new WorkbenchError('SESSION_LIMIT', 409);
    const record = { id: randomUUID(), flowId, busy: true };
    this.sessions.set(record.id, record); // Reserve capacity before awaiting a factory.
    try { await this._install(record); record.busy = false; return await this.inspect(record.id); }
    catch (error) { this.sessions.delete(record.id); throw error; }
  }

  listSessions() {
    return [...this.sessions.values()].filter(record => record.machine).map(record => ({
      id: record.id, flowId: record.flowId, name: this.flows.get(record.flowId).name,
      turns: record.totalTurns, busy: record.busy
    }));
  }

  async inspect(id) {
    const record = this._record(id);
    if (record.busy) throw new WorkbenchError('SESSION_BUSY', 409);
    const machine = record.machine;
    const turns = record.totalTurns;
    const snapshot = await this._snapshot(record);
    if (record.busy || record.machine !== machine || record.totalTurns !== turns) throw new WorkbenchError('SESSION_BUSY', 409);
    return snapshot;
  }

  async _snapshot(record) {
    const session = await record.machine.storage.getSession(record.sessionId);
    const state = session?.state ?? null;
    const last = record.history[record.history.length - 1] ?? null;
    const ended = Boolean(session?.data?.__ussdLifecycle?.completedResponse) ||
      Boolean(last && last.nextState === null && ['success', 'blocked', 'replay', 'flow_restart'].includes(last.outcome));
    record.hadSession ||= Boolean(session);
    const expired = record.hadSession && !session;
    const status = expired ? 'expired' : record.failure ? 'error' : ended ? 'ended' : last?.outcome === 'error' ? 'error' : last ? 'active' : 'idle';
    return {
      id: record.id, flowId: record.flowId, name: this.flows.get(record.flowId).name,
      status, state, initialState: record.machine.initialState,
      stateInfo: new StateInspector(record.machine).getStateInfo(state || record.machine.initialState),
      definition: JSON.parse(JSON.stringify(record.definition)),
      analysis: JSON.parse(JSON.stringify(record.analysis)), data: publicData(record.definition, session?.data),
      stateHistory: (session?.stateHistory || []).slice(-64),
      response: expired ? null : record.response,
      error: record.failure, ended,
      validationError: last?.outcome === 'validation_error',
      totalTurns: record.totalTurns, history: record.history.map(event => ({ ...event }))
    };
  }

  async send(id, input) {
    const record = this._record(id);
    if (typeof input !== 'string' || input.length > 160) throw new WorkbenchError('INVALID_INPUT');
    if (record.busy) throw new WorkbenchError('SESSION_BUSY', 409);
    record.busy = true;
    try {
      const before = await this._snapshot(record);
      if (before.ended || before.status === 'expired') throw new WorkbenchError('SESSION_CLOSED', 409);
      record.failure = null;
      record.response = null;
      let response;
      try {
        response = await record.machine.processInput(record.sessionId, input);
      } catch {
        // The trace retains structural classification; exception text stays local.
        record.failure = 'TURN_FAILED';
      }
      if (!record.failure) {
        if (typeof response !== 'string' || Buffer.byteLength(response) > 8192) record.failure = 'RESPONSE_TOO_LARGE';
        else record.response = response;
      }
      return await this._snapshot(record);
    } finally { record.busy = false; }
  }

  async reset(id) {
    const record = this._record(id);
    if (record.busy) throw new WorkbenchError('SESSION_BUSY', 409);
    record.busy = true;
    try {
      await record.machine.endSession(record.sessionId);
      await this._install(record);
      return await this._snapshot(record);
    }
    finally { record.busy = false; }
  }

  async closeSession(id) {
    const record = this._record(id);
    if (record.busy) throw new WorkbenchError('SESSION_BUSY', 409);
    record.busy = true;
    try { await record.machine.endSession(record.sessionId); this.sessions.delete(id); }
    finally { record.busy = false; }
  }

  // Existing utilities use the same managed session, so their turns appear in
  // inspection/history and follow reset/isolation rules. They receive public data.
  _client(id) {
    this._record(id);
    return {
      processInput: async (_sessionId, input) => {
        const result = await this.send(id, input);
        if (result.response === null) throw new WorkbenchError('TURN_FAILED', 500);
        return result.response;
      },
      getCurrentState: async () => (await this.inspect(id)).state,
      getSessionData: async () => (await this.inspect(id)).data.values,
      endSession: () => this.reset(id)
    };
  }

  getSimulator(id, options = {}) { return new USSDSimulator(this._client(id), options); }
  getTester(id) {
    const tester = new USSDTester(this._client(id));
    const reset = tester.reset.bind(tester);
    tester.reset = newSessionId => {
      const pending = tester._pendingPromise;
      reset(newSessionId);
      tester._pendingPromise = pending.catch(() => {}).then(() => this.reset(id));
      return tester;
    };
    return tester;
  }

  async close() {
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
    this.closed = true;
  }
}

module.exports = { LocalWorkbench, WorkbenchError };
