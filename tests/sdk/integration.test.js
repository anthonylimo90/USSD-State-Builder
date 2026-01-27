const { createApp } = require('../../lib/sdk');
const { Validators } = require('../../lib/ValidationLibrary');

describe('SDK Integration', () => {
  test('simple menu flow with routing', async () => {
    const app = createApp()
      .state('welcome', s => s
        .message('Welcome\n1. Balance\n2. Exit')
        .on('1').goto('balance')
        .on('2').end('Goodbye!')
      )
      .state('balance', s => s
        .run(async () => 'Your balance is KES 1,500')
        .end()
      )
      .start('welcome')
      .logger(null)
      .build();

    // New session -> welcome menu shown
    const res1 = await app.processInput('sess1', '');
    expect(res1).toBe('CON Welcome\n1. Balance\n2. Exit');

    // Select balance -> goto resolves target state's handler
    const res2 = await app.processInput('sess1', '1');
    expect(res2).toBe('END Your balance is KES 1,500');
  });

  test('exit route should terminate', async () => {
    const app = createApp()
      .state('welcome', s => s
        .message('Welcome\n1. Continue\n2. Exit')
        .on('1').goto('next')
        .on('2').end('Goodbye!')
      )
      .state('next', s => s.message('Next page').end())
      .start('welcome')
      .logger(null)
      .build();

    const res1 = await app.processInput('sess2', '');
    expect(res1).toBe('CON Welcome\n1. Continue\n2. Exit');

    const res2 = await app.processInput('sess2', '2');
    expect(res2).toBe('END Goodbye!');
  });

  test('multi-step flow with data persistence', async () => {
    const app = createApp()
      .state('enterPhone', s => s
        .message('Enter phone number:')
        .save('phone')
        .next('enterAmount')
      )
      .state('enterAmount', s => s
        .message('Enter amount:')
        .save('amount')
        .next('confirm')
      )
      .state('confirm', s => s
        .run(async (input, sid, ctx) => {
          const { phone, amount } = ctx.sessionData;
          return `Send KES ${amount} to ${phone}?\n1. Yes\n2. No`;
        })
        .on('1').end('Transaction sent!')
        .on('2').end('Cancelled.')
      )
      .start('enterPhone')
      .logger(null)
      .build();

    // Start -> shows enterPhone prompt
    const res1 = await app.processInput('sess3', '');
    expect(res1).toBe('CON Enter phone number:');

    // Enter phone -> saves phone, shows enterAmount prompt
    const res2 = await app.processInput('sess3', '254700000000');
    expect(res2).toBe('CON Enter amount:');

    // Enter amount -> saves amount, shows confirm prompt
    const res3 = await app.processInput('sess3', '500');
    expect(res3).toBe('CON Send KES 500 to 254700000000?\n1. Yes\n2. No');

    // Confirm
    const res4 = await app.processInput('sess3', '1');
    expect(res4).toBe('END Transaction sent!');
  });

  test('cancel in confirm step', async () => {
    const app = createApp()
      .state('enterPhone', s => s
        .message('Enter phone:')
        .save('phone')
        .next('confirm')
      )
      .state('confirm', s => s
        .run(async (input, sid, ctx) =>
          `Send to ${ctx.sessionData.phone}?\n1. Yes\n2. No`)
        .on('1').end('Sent!')
        .on('2').end('Cancelled.')
      )
      .start('enterPhone')
      .logger(null)
      .build();

    await app.processInput('sess4', '');
    await app.processInput('sess4', '254700000000');

    const res = await app.processInput('sess4', '2');
    expect(res).toBe('END Cancelled.');
  });

  test('custom handler returning full result object', async () => {
    const app = createApp()
      .state('start', s => s
        .run(async () => ({
          response: 'CON Choose:\n1. Option A',
          nextState: 'optionA'
        }))
      )
      .state('optionA', s => s
        .message('You chose A')
        .end()
      )
      .start('start')
      .logger(null)
      .build();

    const res1 = await app.processInput('sess5', '');
    expect(res1).toBe('CON Choose:\n1. Option A');

    const res2 = await app.processInput('sess5', '1');
    expect(res2).toBe('END You chose A');
  });

  test('validation errors should show retry message', async () => {
    const app = createApp()
      .state('enterPin', s => s
        .message('Enter 4-digit PIN:')
        .validate(Validators.pin({ length: 4 }))
        .save('pin')
        .next('done')
      )
      .state('done', s => s
        .message('PIN accepted')
        .end()
      )
      .start('enterPin')
      .logger(null)
      .build();

    // Start
    const res1 = await app.processInput('sess6', '');
    expect(res1).toBe('CON Enter 4-digit PIN:');

    // Invalid PIN - validation error includes newline before "Please try again"
    const res2 = await app.processInput('sess6', 'abc');
    expect(res2).toMatch(/CON.*Please try again/is);

    // Valid PIN -> transitions to done
    const res3 = await app.processInput('sess6', '1234');
    expect(res3).toBe('END PIN accepted');
  });

  test('back navigation should work', async () => {
    const app = createApp()
      .state('menu', s => s
        .message('Main Menu\n1. Sub')
        .on('1').goto('sub')
      )
      .state('sub', s => s
        .message('Sub Menu\n0. Back')
      )
      .start('menu')
      .backNavigation(true)
      .logger(null)
      .build();

    const res1 = await app.processInput('sess7', '');
    expect(res1).toBe('CON Main Menu\n1. Sub');

    const res2 = await app.processInput('sess7', '1');
    expect(res2).toBe('CON Sub Menu\n0. Back');

    // Press 0 for back navigation (handled by engine)
    const res3 = await app.processInput('sess7', '0');
    expect(res3).toBe('CON Main Menu\n1. Sub');
  });

  test('initial state defaults to first defined state', async () => {
    const app = createApp()
      .state('first', s => s.message('First').end())
      .state('second', s => s.message('Second').end())
      .logger(null)
      .build();

    const res = await app.processInput('sess8', '');
    expect(res).toBe('END First');
  });

  test('middleware integration', async () => {
    const log = [];
    const app = createApp()
      .state('welcome', s => s.message('Hello').end())
      .start('welcome')
      .use('afterProcess', async (ctx, next) => {
        log.push(ctx.response);
        await next();
      })
      .logger(null)
      .build();

    await app.processInput('sess9', '');
    expect(log).toEqual(['END Hello']);
  });

  test('save with function mapper', async () => {
    const app = createApp()
      .state('amount', s => s
        .message('Enter amount:')
        .save((input) => ({ amount: parseInt(input, 10), currency: 'KES' }))
        .next('confirm')
      )
      .state('confirm', s => s
        .run(async (input, sid, ctx) =>
          `Amount: ${ctx.sessionData.currency} ${ctx.sessionData.amount}`)
        .end()
      )
      .start('amount')
      .logger(null)
      .build();

    const res1 = await app.processInput('sess10', '');
    expect(res1).toBe('CON Enter amount:');

    // Enter amount -> saves with mapper, shows confirm
    const res2 = await app.processInput('sess10', '1000');
    expect(res2).toBe('END Amount: KES 1000');
  });

  test('route end without custom text uses message', async () => {
    const app = createApp()
      .state('menu', s => s
        .message('Done processing')
        .on('1').end()
      )
      .start('menu')
      .logger(null)
      .build();

    await app.processInput('sess11', '');
    const res = await app.processInput('sess11', '1');
    expect(res).toBe('END Done processing');
  });

  test('reply route stays in same state', async () => {
    const app = createApp()
      .state('info', s => s
        .message('Main\n1. Help\n2. Exit')
        .on('1').reply('Help: Call 100')
        .on('2').end('Bye')
      )
      .start('info')
      .logger(null)
      .build();

    const res1 = await app.processInput('sess12', '');
    expect(res1).toBe('CON Main\n1. Help\n2. Exit');

    // Reply keeps us in same state
    const res2 = await app.processInput('sess12', '1');
    expect(res2).toBe('CON Help: Call 100');

    // Still in same state, can exit
    const res3 = await app.processInput('sess12', '2');
    expect(res3).toBe('END Bye');
  });

  test('timeout configuration', async () => {
    const app = createApp()
      .state('welcome', s => s.message('Hello').end())
      .timeout(60)
      .logger(null)
      .build();

    expect(app.timeout).toBe(60);
  });

  test('createApp is re-exported from main module', () => {
    const main = require('../../index');
    expect(typeof main.createApp).toBe('function');
    expect(typeof main.AppBuilder).toBe('function');
    expect(typeof main.StateBuilder).toBe('function');
    expect(typeof main.RouteBuilder).toBe('function');
  });

  test('SDK entry point exports all classes', () => {
    const sdk = require('../../sdk');
    expect(typeof sdk.createApp).toBe('function');
    expect(typeof sdk.AppBuilder).toBe('function');
    expect(typeof sdk.StateBuilder).toBe('function');
    expect(typeof sdk.RouteBuilder).toBe('function');
  });

  test('run() handler with routes: handler runs first, routes override', async () => {
    const app = createApp()
      .state('confirm', s => s
        .run(async (input, sid, ctx) => 'Confirm?\n1. Yes\n2. No')
        .on('1').end('Confirmed!')
        .on('2').end('Declined.')
      )
      .start('confirm')
      .logger(null)
      .build();

    // First call: handler runs, no route matches -> shows prompt
    const res1 = await app.processInput('sess13', '');
    expect(res1).toBe('CON Confirm?\n1. Yes\n2. No');

    // Second call: handler runs, route matches -> route overrides
    const res2 = await app.processInput('sess13', '1');
    expect(res2).toBe('END Confirmed!');
  });

  test('goto route resolves target state message', async () => {
    const app = createApp()
      .state('menu', s => s
        .message('Menu\n1. Profile\n2. Exit')
        .on('1').goto('profile')
        .on('2').end('Bye')
      )
      .state('profile', s => s
        .message('Your profile\nName: John')
        .end()
      )
      .start('menu')
      .logger(null)
      .build();

    await app.processInput('sess14', '');
    const res = await app.processInput('sess14', '1');
    expect(res).toBe('END Your profile\nName: John');
  });

  test('unmatched input with no default next stays in state', async () => {
    const app = createApp()
      .state('menu', s => s
        .message('Choose:\n1. A')
        .on('1').end('A!')
      )
      .start('menu')
      .logger(null)
      .build();

    const res1 = await app.processInput('sess15', '');
    expect(res1).toBe('CON Choose:\n1. A');

    // Unmatched input -> message shown again, state unchanged
    const res2 = await app.processInput('sess15', '9');
    expect(res2).toBe('CON Choose:\n1. A');

    // Correct input works
    const res3 = await app.processInput('sess15', '1');
    expect(res3).toBe('END A!');
  });
});
