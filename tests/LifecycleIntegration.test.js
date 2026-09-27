const { createApp, USSDStateMachine, ValidationError } = require('..');

describe('runtime lifecycle contract', () => {
  test('creates a session for a static initial response and reports ordered events', async () => {
    const events = [];
    const app = createApp()
      .state('home', s => s.message('Home').onEnter(() => events.push('state:enter:home'))
        .onExit(() => events.push('state:exit:home')).on('1').goto('menu'))
      .state('menu', s => s.message('Menu').onEnter(() => events.push('state:enter:menu')))
      .hooks({
        onStateEnter: state => events.push(`global:enter:${state}`),
        onStateExit: state => events.push(`global:exit:${state}`)
      })
      .logger(null)
      .build();
    for (const hook of ['onSessionStart', 'onStateChange', 'onSessionEnd']) {
      app.use(hook, async (ctx, next) => {
        events.push(`${hook}:${ctx.currentState}${ctx.nextState ? `>${ctx.nextState}` : ''}`);
        if (next) await next();
      });
    }

    expect(await app.processInput('events', '')).toBe('CON Home');
    expect(await app.isSessionActive('events')).toBe(true);
    expect(events).toEqual([
      'onSessionStart:home', 'state:enter:home', 'global:enter:home'
    ]);

    events.length = 0;
    expect(await app.processInput('events', '1')).toBe('CON Menu');
    expect(events).toEqual([
      'state:exit:home', 'global:exit:home', 'onStateChange:home>menu',
      'state:enter:menu', 'global:enter:menu'
    ]);
  });

  test('back navigation emits one transition and runs afterProcess', async () => {
    const events = [];
    const app = createApp()
      .state('home', s => s.message('Home').onEnter(() => events.push('enter home'))
        .on('1').goto('menu'))
      .state('menu', s => s.message('Menu').onExit(() => events.push('exit menu')))
      .logger(null)
      .build();
    app.use('onStateChange', async (ctx, next) => {
      events.push(`${ctx.currentState}>${ctx.nextState}`);
      await next();
    });
    app.use('afterProcess', async (ctx, next) => {
      events.push(`after ${ctx.response}`);
      await next();
    });

    await app.processInput('back-events', '');
    await app.processInput('back-events', '1');
    events.length = 0;
    expect(await app.processInput('back-events', '0')).toBe('CON Home');
    expect(events).toEqual(['after CON Home', 'exit menu', 'menu>home', 'enter home']);
  });

  test('validation failures retain and refresh the initial session without a state change', async () => {
    const events = [];
    const app = new USSDStateMachine({
      initialState: 'INPUT',
      logger: null,
      states: {
        INPUT: {
          validator: input => { if (input === 'bad') throw new ValidationError('Invalid'); },
          handler: () => ({ response: 'CON Enter value' })
        }
      }
    });
    app.use('onSessionStart', async (ctx, next) => { events.push('start'); await next(); });
    app.use('onStateChange', async (ctx, next) => { events.push('change'); await next(); });

    expect(await app.processInput('invalid-initial', 'bad')).toContain('Please try again');
    expect(await app.isSessionActive('invalid-initial')).toBe(true);
    expect(events).toEqual(['start']);
    expect(await app.processInput('invalid-initial', 'good')).toBe('CON Enter value');
    expect(events).toEqual(['start']);
  });

  test('END completes once and a repeated request returns the same response', async () => {
    let calls = 0;
    const events = [];
    const app = createApp()
      .state('home', s => s.run(() => { calls++; return 'Finished'; }).end())
      .logger(null)
      .build();
    app.use('onSessionEnd', async (ctx, next) => {
      events.push(ctx.reason);
      await next();
    });

    expect(await app.processInput('completed', '')).toBe('END Finished');
    expect(await app.processInput('completed', '')).toBe('END Finished');
    expect(calls).toBe(1);
    expect(events).toEqual(['completed']);
    await app.endSession('completed');
    expect(events).toEqual(['completed']);
  });

  test('a failed post-commit notification does not replay the handler or suppress later notifications', async () => {
    let calls = 0;
    const observed = [];
    const app = createApp()
      .state('home', s => s.run(() => { calls++; return 'Finished'; })
        .onEnter(() => { throw new Error('observer failed'); })
        .end())
      .hooks({ onStateEnter: () => observed.push('global entered') })
      .logger({ error: (message, error) => observed.push(error.message) })
      .build();
    app.hookErrorStrategy = 'throw';
    app.use('onSessionEnd', async (ctx, next) => {
      observed.push('ended');
      await next();
    });

    expect(await app.processInput('notification-failure', '')).toBe('END Finished');
    expect(await app.processInput('notification-failure', '')).toBe('END Finished');
    expect(calls).toBe(1);
    expect(observed).toEqual(['observer failed', 'global entered', 'ended']);
  });

  test('explicit termination emits once and blocked requests do not start a session', async () => {
    const events = [];
    const app = createApp().state('home', s => s.message('Home')).logger(null).build();
    app.use('beforeProcess', async (ctx, next) => {
      if (ctx.sessionId === 'blocked') {
        ctx.blocked = true;
        ctx.response = 'END Blocked';
        return;
      }
      await next();
    });
    app.use('onSessionStart', async (ctx, next) => { events.push('start'); await next(); });
    app.use('onSessionEnd', async (ctx, next) => { events.push(ctx.reason); await next(); });

    expect(await app.processInput('blocked', '')).toBe('END Blocked');
    expect(await app.isSessionActive('blocked')).toBe(false);
    expect(events).toEqual([]);
    await app.processInput('explicit', '');
    await app.endSession('explicit');
    await app.endSession('explicit');
    expect(events).toEqual(['start', 'explicit']);
  });
});
