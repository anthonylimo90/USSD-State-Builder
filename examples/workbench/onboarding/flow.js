const { createApp, InMemoryStorage } = require('ussd-state-builder');

// Deliberately broken teaching example. Follow docs/WORKBENCH-QUICKSTART.md to fix it.
function createMachine({ storage, clock, effects }) {
  return createApp().flowVersion('onboarding-stock-v1').storage(storage).clock(clock).logger(null)
    .state('HOME', state => state.message('Synthetic stock shop\n1 Check stock').on('1').goto('QUANTITY'))
    .state('QUANTITY', state => state.run(async input => {
      if (!input) return 'Enter a quantity (try 3).';
      const stock = await effects.call('inventory');
      if (Number(input) > stock.available) {
        throw new Error('Teaching defect: insufficient stock should allow a retry');
      }
      return 'END Synthetic reservation accepted. No purchase was made.';
    })).start('HOME').build();
}

const responses = { 'stock-two': { available: 2 } };
function createHandsetMachine() {
  const clock = { now: () => Date.now() };
  return createMachine({ storage: new InMemoryStorage({ now: clock.now }), clock,
    effects: { call: async () => ({ ...responses['stock-two'] }) } });
}

module.exports = { createMachine, createHandsetMachine, responses };
