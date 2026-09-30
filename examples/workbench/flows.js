const { createApp, USSDStateMachine, InMemoryStorage, ValidationError } = require('ussd-state-builder');

function quantity(input) {
  if (!/^[1-9]$/.test(input)) throw new ValidationError('Enter a quantity from 1 to 9');
}

function buildSdkFlow(storage, clock) {
  return createApp().flowVersion('shop-v1').storage(storage).clock(clock).logger(null)
    .state('MENU', state => state.message('Demo shop\n1 Seed pack\n2 Exit')
      .on('1').goto('QUANTITY').on('2').end('Goodbye.'))
    .state('QUANTITY', state => state.validate(quantity).run(input => input ? {
      response: 'CON Enter a synthetic PIN', nextState: 'PIN', data: { quantity: Number(input) }
    } : 'Quantity (1-9)?\n0 Back').metadata({ dynamic: false, terminal: false,
      transitions: [{ to: 'PIN', kind: 'next' }], field: { name: 'quantity', sensitivity: 'public' } }))
    .state('PIN', state => state.message('Enter a synthetic PIN').save('pin').sensitivity('secret').next('DONE'))
    .state('DONE', state => state.message('Saved demo order. No purchase was made.').end())
    .start('MENU').build();
}

function buildTraditionalFlow(storage, clock) {
  return new USSDStateMachine({ initialState: 'MENU', flowVersion: 'shop-v1',
    storage, now: clock.now, logger: null, states: {
      MENU: { metadata: { dynamic: false, terminal: false, transitions: [
        { input: '1', to: 'QUANTITY', kind: 'route' }, { input: '2', terminal: true, kind: 'route' }
      ] }, handler: input => input === '2' ? { response: 'END Goodbye.' } : input === '1' ?
        { response: 'CON Quantity (1-9)?\n0 Back', nextState: 'QUANTITY' } :
        { response: 'CON Demo shop\n1 Seed pack\n2 Exit' } },
      QUANTITY: { validator: quantity, metadata: { dynamic: false, terminal: false,
        transitions: [{ to: 'PIN', kind: 'next' }], field: { name: 'quantity', sensitivity: 'public' } },
      handler: input => input ? { response: 'CON Enter a synthetic PIN', nextState: 'PIN', data: { quantity: Number(input) } } :
        { response: 'CON Quantity (1-9)?\n0 Back' } },
      PIN: { metadata: { dynamic: false, terminal: false, transitions: [{ to: 'DONE', kind: 'next' }],
        field: { name: 'pin', sensitivity: 'secret' } }, handler: input => input ?
        { response: 'END Saved demo order. No purchase was made.', nextState: 'DONE', data: { pin: input } } :
        { response: 'CON Enter a synthetic PIN' } },
      DONE: { metadata: { dynamic: false, terminal: true }, handler: () => ({ response: 'END Saved demo order. No purchase was made.' }) }
    } });
}

function createSdkFlow() { return buildSdkFlow(new InMemoryStorage(), { now: () => Date.now() }); }
function createTraditionalFlow() { return buildTraditionalFlow(new InMemoryStorage(), { now: () => Date.now() }); }
module.exports = { createSdkFlow, createTraditionalFlow, buildSdkFlow, buildTraditionalFlow };
