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
