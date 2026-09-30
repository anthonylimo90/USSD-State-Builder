const { randomUUID } = require('node:crypto');
const { createReplayFixture, createTraceEvent } = require('./TraceSchema');
const InMemoryStorage = require('./InMemoryStorage');
const { USSDTester } = require('./TestingUtils');

const codes = new Set(['INVALID_CLOCK', 'NON_MONOTONIC_CLOCK', 'INVALID_FAKE_RESPONSE', 'INVALID_FIXTURE',
  'SYNTHETIC_REPLACEMENTS_REQUIRED', 'REPLAY_FACTORY_REQUIRED', 'FAKE_RESPONSE_REQUIRED', 'UNSCRIPTED_EFFECT',
  'ISOLATED_REPLAY_FACTORY_REQUIRED', 'FLOW_VERSION_MISMATCH', 'TURN_OBSERVATION_REQUIRED', 'UNCONSUMED_EFFECT',
  'EXPECTATION_MISMATCH', 'REPLAY_FAILED', 'REPLAY_CLEANUP_FAILED', 'INCOMPLETE_HISTORY',
  'EXPORT_NEEDS_1_TO_64_TURNS', 'EXPORT_FACTORY_REFERENCE_REQUIRED']);
class ReplayError extends Error {
  constructor(code, turn = null) {
    const safeCode = codes.has(code) ? code : 'REPLAY_FAILED';
    super(safeCode); this.name = 'ReplayError'; this.code = safeCode;
    this.turn = Number.isSafeInteger(turn) && turn >= 1 && turn <= 64 ? turn : null;
  }
}
function parseFixture(source) {
  try { return createReplayFixture(source); } catch { throw new ReplayError('INVALID_FIXTURE'); }
}

class ReplayClock {
  constructor(startMs) {
    if (!Number.isSafeInteger(startMs) || startMs < 0 || startMs > 8640000000000000) throw new ReplayError('INVALID_CLOCK');
    this.startMs = startMs;
    this.elapsedMs = 0;
    this.now = () => this.startMs + this.elapsedMs;
  }
  advanceTo(atMs) {
    if (!Number.isSafeInteger(atMs) || atMs < this.elapsedMs || atMs > 86400000 || this.startMs + atMs > 8640000000000000) {
      throw new ReplayError('NON_MONOTONIC_CLOCK');
    }
    this.elapsedMs = atMs;
  }
  async sleep(ms) {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new ReplayError('INVALID_CLOCK');
    this.advanceTo(this.elapsedMs + ms);
  }
}

function cloneFake(value) {
  let nodes = 0;
  const seen = new Set();
  const copy = (item, depth) => {
    if (++nodes > 4096 || depth > 32) throw new ReplayError('INVALID_FAKE_RESPONSE');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object' || seen.has(item) ||
        (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) {
      throw new ReplayError('INVALID_FAKE_RESPONSE');
    }
    seen.add(item);
    const entries = [];
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new ReplayError('INVALID_FAKE_RESPONSE');
      }
      entries.push([key, copy(descriptor.value, depth + 1)]);
    }
    if (Array.isArray(item) && entries.length !== item.length) throw new ReplayError('INVALID_FAKE_RESPONSE');
    const result = Array.isArray(item) ? entries.map(([key, entry], index) => {
      if (key !== String(index)) throw new ReplayError('INVALID_FAKE_RESPONSE');
      return entry;
    }) : Object.fromEntries(entries);
    seen.delete(item);
    return result;
  };
  let result;
  try { result = copy(value, 0); } catch { throw new ReplayError('INVALID_FAKE_RESPONSE'); }
  if (Buffer.byteLength(JSON.stringify(result)) > 32768) throw new ReplayError('INVALID_FAKE_RESPONSE');
  return result;
}

const placeholder = value => /^(?:__REPLACE_INPUT_|REPLACE_RESPONSE_)/.test(value);

function executableFixture(source) {
  const fixture = parseFixture(source);
  if (fixture.provenance !== 'synthetic') throw new ReplayError('SYNTHETIC_REPLACEMENTS_REQUIRED');
  if (fixture.turns.some(turn => placeholder(turn.input.value) || turn.external.some(effect => placeholder(effect.responseRef)))) {
    throw new ReplayError('SYNTHETIC_REPLACEMENTS_REQUIRED');
  }
  let end = 0;
  for (const turn of fixture.turns) {
    if (turn.atMs < end) throw new ReplayError('NON_MONOTONIC_CLOCK');
    end = turn.atMs;
    for (const effect of turn.external) {
      if (effect.atMs < end) throw new ReplayError('NON_MONOTONIC_CLOCK');
      end = effect.atMs;
    }
  }
  if (fixture.clock.startMs + end > 8640000000000000) throw new ReplayError('INVALID_CLOCK');
  return fixture;
}

/** Execute only an explicitly supplied replay factory, using isolated time/storage/fakes. */
async function replayScenario(source, { createMachine, responses = {} } = {}) {
  const fixture = executableFixture(source);
  if (typeof createMachine !== 'function') throw new ReplayError('REPLAY_FACTORY_REQUIRED');
  if (!responses || typeof responses !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(responses))) {
    throw new ReplayError('INVALID_FAKE_RESPONSE');
  }
  const fakeValues = new Map();
  for (const effect of fixture.turns.flatMap(turn => turn.external)) {
    const descriptor = Object.getOwnPropertyDescriptor(responses, effect.responseRef);
    if (!descriptor) throw new ReplayError('FAKE_RESPONSE_REQUIRED');
    if (!Object.hasOwn(descriptor, 'value')) throw new ReplayError('INVALID_FAKE_RESPONSE');
    if (!fakeValues.has(effect.responseRef)) fakeValues.set(effect.responseRef, cloneFake(descriptor.value));
  }
  const clock = new ReplayClock(fixture.clock.startMs);
  const storage = new InMemoryStorage({ now: clock.now });
  const sessionId = `replay_${randomUUID()}`;
  let script = [], calls = 0, failure = null, turnIndex = -1, active = false;
  const fail = code => { failure ||= new ReplayError(code, turnIndex + 1); throw failure; };
  const effects = Object.freeze({
    async call(operation) {
      if (!active) return fail('UNSCRIPTED_EFFECT');
      const descriptor = script[calls++];
      if (!descriptor || descriptor.operation !== operation) return fail('UNSCRIPTED_EFFECT');
      try { clock.advanceTo(descriptor.atMs); } catch { return fail('NON_MONOTONIC_CLOCK'); }
      if (descriptor.result === 'error') {
        const error = new Error('Synthetic external failure');
        error.name = 'ReplayEffectError'; error.statusCode = descriptor.statusCode;
        throw error;
      }
      return cloneFake(fakeValues.get(descriptor.responseRef));
    }
  });
  let machine, replayError;
  const turns = [];
  try {
    machine = await createMachine({ clock, storage, effects, sessionId });
    if (!machine || machine.storage !== storage || machine.now !== clock.now || typeof machine.useTurnObserver !== 'function') {
      throw new ReplayError('ISOLATED_REPLAY_FACTORY_REQUIRED');
    }
    if (machine.getFlowDefinition().flowVersion !== fixture.flowVersion) throw new ReplayError('FLOW_VERSION_MISMATCH');
    machine.logger = null;
    let observed = null;
    machine.useTurnObserver(observation => { observed = observation; });
    const tester = new USSDTester({
      async processInput(_id, input) {
        observed = null;
        let response;
        try { response = await machine.processInput(sessionId, input); }
        catch { response = 'CON Replay turn failed.'; }
        if (failure) throw failure;
        if (!observed) throw new ReplayError('TURN_OBSERVATION_REQUIRED', turnIndex + 1);
        if (calls !== script.length) throw new ReplayError('UNCONSUMED_EFFECT', turnIndex + 1);
        return response;
      },
      getCurrentState: async () => observed?.nextState ?? null,
      getSessionData: async () => ({})
    }, { sessionId });
    for (const [index, turn] of fixture.turns.entries()) {
      turnIndex = index;
      clock.advanceTo(turn.atMs); script = turn.external; calls = 0; active = true;
      await tester.input(turn.input.value).expect(() => {
        if (observed.outcome !== turn.expected.outcome || (observed.nextState ?? null) !== turn.expected.state) {
          throw new ReplayError('EXPECTATION_MISMATCH', index + 1);
        }
      }).run();
      active = false;
      turns.push({ turn: index + 1, atMs: clock.elapsedMs, outcome: observed.outcome, state: observed.nextState ?? null });
    }
  } catch (error) {
    replayError = error instanceof ReplayError ? new ReplayError(error.code, error.turn)
      : new ReplayError('REPLAY_FAILED', turnIndex < 0 ? null : turnIndex + 1);
  } finally {
    active = false;
    // Skip session-end hooks; release only factory-owned local resources.
    storage.clear();
    if (machine?.cleanup && machine.storage === storage) {
      try { await machine.cleanup(); } catch { replayError ||= new ReplayError('REPLAY_CLEANUP_FAILED'); }
    }
  }
  if (replayError) throw replayError;
  return { passed: true, caseId: fixture.caseId, turns };
}

/** Export structural observations only, with aliases for every missing input. */
function createReplayDraft(events, { caseId = 'workbench-regression', complete = true } = {}) {
  if (!complete) throw new ReplayError('INCOMPLETE_HISTORY');
  if (!Array.isArray(events) || !events.length || events.length > 64) throw new ReplayError('EXPORT_NEEDS_1_TO_64_TURNS');
  const history = events.map(createTraceEvent);
  const startMs = Date.parse(history[0].occurredAt);
  const version = history[0].flowVersion;
  if (history.some(event => event.flowVersion !== version)) throw new ReplayError('FLOW_VERSION_MISMATCH');
  return createReplayFixture({ schemaVersion: 1, fixtureType: 'turn-sequence', provenance: 'captured-redacted',
    caseId, flowVersion: version, clock: { startMs }, turns: history.map((event, index) => ({
      atMs: Math.max(0, Date.parse(event.occurredAt) - startMs),
      input: { kind: 'redacted', alias: `input-${index + 1}` }, external: [],
      expected: { outcome: event.outcome, state: event.nextState }
    })) });
}

function syntheticTemplate(fixture) {
  return createReplayFixture({ ...fixture, provenance: 'synthetic', turns: fixture.turns.map((turn, index) => ({
    ...turn, input: fixture.provenance === 'synthetic' ? turn.input : { kind: 'synthetic', value: `__REPLACE_INPUT_${index + 1}__` },
    external: turn.external.map((effect, effectIndex) => ({ ...effect,
      responseRef: effect.responseRef ?? `REPLACE_RESPONSE_${index + 1}_${effectIndex + 1}` }))
  })) });
}

/** Generate a Jest/USSDTester scenario; placeholders deliberately cannot execute. */
function exportReplayTest(source, { modulePath, factoryExport, responsesExport } = {}) {
  const fixture = parseFixture(source);
  if (typeof modulePath !== 'string' || !/^\.{1,2}\/[A-Za-z0-9_./-]{1,240}$/.test(modulePath) ||
      typeof factoryExport !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(factoryExport) ||
      (responsesExport !== undefined && (typeof responsesExport !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(responsesExport)))) {
    throw new ReplayError('EXPORT_FACTORY_REFERENCE_REQUIRED');
  }
  const synthetic = syntheticTemplate(fixture);
  return `// Synthetic regression scenario. Save under tests/ (factory path is relative to this file).
// Replace __REPLACE_INPUT_*__ and REPLACE_RESPONSE_* values, script fake effects and set fixed expectations.
// Captured traces omit inputs, response bodies and dependencies; this template cannot reconstruct them.
const { replayScenario } = require('ussd-state-builder');
const replayModule = require(${JSON.stringify(modulePath)});
const fixture = ${JSON.stringify(synthetic, null, 2)};
test(${JSON.stringify(fixture.caseId)}, async () => {
  await replayScenario(fixture, {
    createMachine: replayModule[${JSON.stringify(factoryExport)}],
    responses: ${responsesExport ? `replayModule[${JSON.stringify(responsesExport)}]` : '{}'}
  });
});
`;
}

module.exports = { ReplayError, ReplayClock, replayScenario, createReplayDraft, exportReplayTest, syntheticTemplate, parseFixture };
