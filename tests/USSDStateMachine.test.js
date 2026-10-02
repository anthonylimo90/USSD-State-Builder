const USSDStateMachine = require('../lib/USSDStateMachine');
const ValidationError = require('../lib/ValidationError');
const InMemoryStorage = require('../lib/InMemoryStorage');

describe('USSDStateMachine', () => {
  let ussdConfig;
  let ussdStateMachine;

  beforeEach(() => {
    ussdConfig = {
      initialState: 'WELCOME',
      timeout: 300,
      states: {
        WELCOME: {
          handler: async (input) => {
            if (input === '') {
              return {
                response: 'CON Welcome\n1. Continue\n2. Exit',
                nextState: 'MENU'
              };
            }
          }
        },
        MENU: {
          handler: async (input) => {
            if (input === '1') {
              return {
                response: 'CON Enter your name',
                nextState: 'COLLECT_NAME'
              };
            } else if (input === '2') {
              return {
                response: 'END Goodbye',
                nextState: 'END'
              };
            } else {
              return {
                response: 'CON Invalid input\n1. Continue\n2. Exit'
              };
            }
          }
        },
        COLLECT_NAME: {
          validator: async (input) => {
            if (input.length < 2) {
              throw new ValidationError('Name too short');
            }
          },
          handler: async (input, sessionId) => {
            return {
              response: `CON Hello, ${input}! Enter your age`,
              nextState: 'COLLECT_AGE',
              data: { name: input }
            };
          }
        },
        COLLECT_AGE: {
          validator: async (input) => {
            if (isNaN(input) || input < 18 || input > 100) {
              throw new ValidationError('Invalid age');
            }
          },
          handler: async (input, sessionId) => {
            const data = await ussdStateMachine.getSessionData(sessionId);
            return {
              response: `END Thanks, ${data.name}! Your age is ${input}.`,
              nextState: 'END',
              data: { age: input }
            };
          }
        }
      }
    };
    ussdStateMachine = new USSDStateMachine(ussdConfig);
  });

  test('should start with welcome message', async () => {
    const response = await ussdStateMachine.processInput('session1', '');
    expect(response).toBe('CON Welcome\n1. Continue\n2. Exit');
  });

  test('should handle menu selection', async () => {
    await ussdStateMachine.processInput('session1', '');
    const response = await ussdStateMachine.processInput('session1', '1');
    expect(response).toBe('CON Enter your name');
  });

  test('should handle name input', async () => {
    await ussdStateMachine.processInput('session1', '');
    await ussdStateMachine.processInput('session1', '1');
    const response = await ussdStateMachine.processInput('session1', 'John');
    expect(response).toBe('CON Hello, John! Enter your age');
  });

  test('should handle age input and complete flow', async () => {
    await ussdStateMachine.processInput('session1', '');
    await ussdStateMachine.processInput('session1', '1');
    await ussdStateMachine.processInput('session1', 'John');
    const response = await ussdStateMachine.processInput('session1', '25');
    expect(response).toBe('END Thanks, John! Your age is 25.');
  });

  test('should handle validation errors', async () => {
    await ussdStateMachine.processInput('session1', '');
    await ussdStateMachine.processInput('session1', '1');
    const response = await ussdStateMachine.processInput('session1', 'J');
    expect(response).toBe('CON Name too short\nPlease try again.');
  });

  test('should serialize requests to an existing session', async () => {
    const storage = new InMemoryStorage();
    await storage.setState('shared', 'COUNTER', 300);
    await storage.setData('shared', { count: 0 }, 300);
    const machine = new USSDStateMachine({
      initialState: 'COUNTER',
      storage,
      states: {
        COUNTER: {
          handler: async (input, sessionId, context) => {
            const count = context.sessionData.count + 1;
            await new Promise(resolve => setTimeout(resolve, 10));
            return { response: `CON ${count}`, data: { count } };
          }
        }
      }
    });

    expect(await Promise.all([
      machine.processInput('shared', '1'),
      machine.processInput('shared', '2')
    ])).toEqual(['CON 1', 'CON 2']);
    expect(await machine.getSessionData('shared')).toEqual({ count: 2 });
  });

  test('does not persist an undefined terminal next state', async () => {
    await ussdStateMachine.processInput('terminal', '');
    await ussdStateMachine.processInput('terminal', '2');
    expect(await ussdStateMachine.getCurrentState('terminal')).toBe('MENU');
  });

  test.each([null, 'v1'])('terminal data and replay receipt share one storage write (version %s)', async version => {
    const storage = new InMemoryStorage();
    await storage.setState('terminal-data', 'START', 300);
    if (version) await storage.setData('terminal-data', { __ussdFlow: { version } }, 300);
    const write = jest.spyOn(storage, 'setData');
    const incoming = { name: 'Ada', __ussdFlow: { version: 'wrong' },
      __ussdLifecycle: { completedResponse: 'END Wrong' } };
    const machine = new USSDStateMachine({ initialState: 'START', storage,
      ...(version ? { flowVersion: version } : {}), logger: null,
      states: { START: { handler: () => ({ response: 'END Saved', data: incoming }) } }
    });
    expect(await machine.processInput('terminal-data', 'Ada')).toBe('END Saved');
    expect(write).toHaveBeenCalledTimes(1);
    const saved = await storage.getData('terminal-data');
    expect(saved).toMatchObject({ name: 'Ada', __ussdLifecycle: { completedResponse: 'END Saved' } });
    expect(saved.__ussdFlow).toEqual(version ? { version } : undefined);
    expect(incoming.__ussdFlow.version).toBe('wrong');
    expect(incoming.__ussdLifecycle.completedResponse).toBe('END Wrong');
    expect(await machine.processInput('terminal-data', 'again')).toBe('END Saved');
    expect(write).toHaveBeenCalledTimes(1);
  });

  test('afterProcess sees terminal handler data before choosing a continued response', async () => {
    const storage = new InMemoryStorage();
    const machine = new USSDStateMachine({ initialState: 'START', storage, logger: null,
      states: { START: { handler: () => ({ response: 'END Saved', data: { name: 'Ada' } }) } }
    });
    machine.use('afterProcess', async context => {
      expect(await storage.getData(context.sessionId)).toEqual({ name: 'Ada' });
      context.response = 'CON Review Ada';
    });
    expect(await machine.processInput('continued', 'Ada')).toBe('CON Review Ada');
    expect(await storage.getData('continued')).toEqual({ name: 'Ada' });
  });

  test('cancelled shared-storage waiters cannot release another turn or block surviving waiters', async () => {
    const storage = new InMemoryStorage();
    let entered, finish;
    const started = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { finish = resolve; });
    const handled = [];
    const config = { initialState: 'COUNTER', storage, logger: null, states: {
      COUNTER: { handler: async (input, id, context) => {
        handled.push(input);
        if (input === 'hold') { entered(); await held; }
        const count = (context.sessionData?.count || 0) + 1;
        return { response: `CON ${count}`, data: { count } };
      } }
    } };
    const first = new USSDStateMachine(config), second = new USSDStateMachine(config);
    const owner = first.processInput('shared-lock', 'hold');
    await started;
    const controller = new AbortController();
    const cancelled = second.processInput('shared-lock', 'cancelled', { signal: controller.signal });
    const surviving = first.processInput('shared-lock', 'surviving');
    controller.abort(new Error('Cancelled queued turn'));
    await expect(cancelled).rejects.toThrow('Cancelled queued turn');
    const last = second.processInput('shared-lock', 'last');
    expect(await second.processInput('independent-lock', 'independent')).toBe('CON 1');
    expect(handled).toEqual(['hold', 'independent']);
    finish();
    expect(await owner).toBe('CON 1');
    expect(await Promise.all([surviving, last])).toEqual(['CON 2', 'CON 3']);
    expect(await storage.getData('shared-lock')).toEqual({ count: 3 });
    expect(first._sessionLocks.size).toBe(0);
  });

  test('rejects an invalid response before changing state, history, data, or lifecycle', async () => {
    const storage = new InMemoryStorage();
    await storage.setState('invalid', 'START', 300);
    await storage.setData('invalid', { original: true }, 300);
    const onExit = jest.fn();
    const machine = new USSDStateMachine({
      initialState: 'START', storage,
      states: {
        START: { handler: () => ({ response: 'invalid', nextState: 'NEXT', data: { changed: true } }) },
        NEXT: { handler: () => ({ response: 'END done' }) }
      },
      hooks: { onStateExit: onExit }
    });

    await expect(machine.processInput('invalid', '1')).rejects.toThrow();
    expect(await storage.getState('invalid')).toBe('START');
    expect(await storage.getData('invalid')).toEqual({ original: true });
    expect(await storage.getStateHistory('invalid')).toEqual([]);
    expect(onExit).not.toHaveBeenCalled();
  });

  test('should handle invalid menu selection', async () => {
    await ussdStateMachine.processInput('session1', '');
    const response = await ussdStateMachine.processInput('session1', '3');
    expect(response).toBe('CON Invalid input\n1. Continue\n2. Exit');
  });
});
