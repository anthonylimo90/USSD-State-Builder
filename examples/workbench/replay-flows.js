const { createApp, InMemoryStorage } = require('ussd-state-builder');
const { buildSdkFlow, buildTraditionalFlow } = require('./flows');

const fakeResponses = { 'inventory-two': { available: 2 }, 'inventory-unavailable': null };
function createSdkReplay({ storage, clock }) {
  const machine = buildSdkFlow(storage, clock);
  return machine;
}
function createTraditionalReplay({ storage, clock }) { return buildTraditionalFlow(storage, clock); }

function lab({ storage, clock, effects }, broken) {
  return createApp().logger(null).storage(storage).clock(clock).flowVersion('replay-lab-v1')
    .state('HOME', state => state.message('Replay lab\n1 Check stock').on('1').goto('QUANTITY'))
    .state('QUANTITY', state => state.run(async input => {
      if (!input) return 'Enter quantity (try 3).';
      const inventory = await effects.call('inventory');
      if (Number(input) > inventory.available) {
        if (broken) throw new Error('Synthetic stock-check defect');
        return { response: 'CON Only 2 available. Try another quantity.', data: { checkedAt: clock.now() } };
      }
      return { response: 'END Synthetic reservation accepted.', data: { checkedAt: clock.now() } };
    })).start('HOME').build();
}
function createReplayLab(context) { return lab(context, false); }
function createBrokenReplayLab(context) { return lab(context, true); }
function createLiveReplayLab() {
  const clock = { now: () => Date.now() };
  return lab({ storage: new InMemoryStorage(), clock,
    effects: { call: async () => ({ available: 2 }) } }, true);
}
function regressionFixture() {
  return { schemaVersion: 1, fixtureType: 'turn-sequence', provenance: 'synthetic', caseId: 'stock-limit-regression',
    flowVersion: 'replay-lab-v1', clock: { startMs: 1780000000000 }, turns: [
      { atMs: 0, input: { kind: 'synthetic', value: '' }, external: [], expected: { outcome: 'success', state: 'HOME' } },
      { atMs: 100, input: { kind: 'synthetic', value: '1' }, external: [], expected: { outcome: 'success', state: 'QUANTITY' } },
      { atMs: 200, input: { kind: 'synthetic', value: '3' }, external: [
        { operation: 'inventory', atMs: 220, result: 'success', statusCode: 200, responseRef: 'inventory-two' }
      ], expected: { outcome: 'success', state: 'QUANTITY' } }
    ] };
}
module.exports = { createSdkReplay, createTraditionalReplay, createReplayLab, createBrokenReplayLab,
  createLiveReplayLab, fakeResponses, regressionFixture };
