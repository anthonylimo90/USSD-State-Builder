const { addPrefix, hasPrefix, isTerminal, buildHandler } = require('../../lib/sdk/compiler');
const StateBuilder = require('../../lib/sdk/StateBuilder');

describe('compiler utilities', () => {
  describe('hasPrefix', () => {
    test('should detect CON prefix', () => {
      expect(hasPrefix('CON Hello')).toBe(true);
    });

    test('should detect END prefix', () => {
      expect(hasPrefix('END Goodbye')).toBe(true);
    });

    test('should return false for unprefixed text', () => {
      expect(hasPrefix('Hello')).toBe(false);
    });

    test('should return false for non-strings', () => {
      expect(hasPrefix(null)).toBe(false);
      expect(hasPrefix(undefined)).toBe(false);
      expect(hasPrefix(42)).toBe(false);
    });
  });

  describe('addPrefix', () => {
    test('should add CON prefix for non-terminal', () => {
      expect(addPrefix('Hello', false)).toBe('CON Hello');
    });

    test('should add END prefix for terminal', () => {
      expect(addPrefix('Goodbye', true)).toBe('END Goodbye');
    });

    test('should not double-prefix CON', () => {
      expect(addPrefix('CON Hello', false)).toBe('CON Hello');
    });

    test('should not double-prefix END', () => {
      expect(addPrefix('END Goodbye', true)).toBe('END Goodbye');
    });

    test('should respect existing prefix even if mismatched', () => {
      expect(addPrefix('CON Hello', true)).toBe('CON Hello');
      expect(addPrefix('END Goodbye', false)).toBe('END Goodbye');
    });
  });

  describe('isTerminal', () => {
    test('should return true when explicitly marked as end', () => {
      const sb = new StateBuilder('test');
      sb.end();
      expect(isTerminal(sb)).toBe(true);
    });

    test('should return false when next state is set', () => {
      const sb = new StateBuilder('test');
      sb.next('other');
      expect(isTerminal(sb)).toBe(false);
    });

    test('should return false when routes have goto targets', () => {
      const sb = new StateBuilder('test');
      sb.on('1').goto('other');
      expect(isTerminal(sb)).toBe(false);
    });

    test('should return true when no continuation path', () => {
      const sb = new StateBuilder('test');
      sb.message('Done');
      expect(isTerminal(sb)).toBe(true);
    });
  });

  describe('buildHandler', () => {
    test('should show message on empty input and not transition', async () => {
      const sb = new StateBuilder('test');
      sb.message('Hello').next('other');
      const handler = buildHandler(sb);
      const result = await handler('', 'session1', {});
      expect(result.response).toBe('CON Hello');
      // No transition on empty input
      expect(result.nextState).toBeUndefined();
    });

    test('should transition on non-empty input with next()', async () => {
      const sb = new StateBuilder('test');
      sb.message('Enter:').next('other');
      const handler = buildHandler(sb);
      const result = await handler('something', 'session1', {});
      expect(result.response).toBe('CON Enter:');
      expect(result.nextState).toBe('other');
    });

    test('should return END-prefixed message when terminal', async () => {
      const sb = new StateBuilder('test');
      sb.message('Goodbye').end();
      const handler = buildHandler(sb);
      const result = await handler('', 'session1', {});
      expect(result.response).toBe('END Goodbye');
      expect(result.nextState).toBeUndefined();
    });

    test('should handle route matching with goto', async () => {
      const sb = new StateBuilder('test');
      sb.message('Choose:\n1. A\n2. B');
      sb.on('1').goto('stateA');
      sb.on('2').goto('stateB');
      const handler = buildHandler(sb);

      // No allStates provided, so goto falls back to message
      const result1 = await handler('1', 'session1', {});
      expect(result1.nextState).toBe('stateA');
      expect(result1.response).toBe('CON Choose:\n1. A\n2. B');

      const result2 = await handler('2', 'session1', {});
      expect(result2.nextState).toBe('stateB');
    });

    test('goto should resolve target state message when allStates provided', async () => {
      const menuSb = new StateBuilder('menu');
      menuSb.message('Menu\n1. Profile');
      menuSb.on('1').goto('profile');

      const profileSb = new StateBuilder('profile');
      profileSb.message('Your profile info').end();

      const allStates = new Map([['menu', menuSb], ['profile', profileSb]]);
      const handler = buildHandler(menuSb, allStates);

      const result = await handler('1', 'session1', {});
      expect(result.nextState).toBe('profile');
      expect(result.response).toBe('END Your profile info');
    });

    test('should handle route with end()', async () => {
      const sb = new StateBuilder('test');
      sb.on('1').end('Done!');
      const handler = buildHandler(sb);
      const result = await handler('1', 'session1', {});
      expect(result.response).toBe('END Done!');
      expect(result.nextState).toBeUndefined();
    });

    test('should handle route with reply()', async () => {
      const sb = new StateBuilder('test');
      sb.on('1').reply('Info here');
      const handler = buildHandler(sb);
      const result = await handler('1', 'session1', {});
      expect(result.response).toBe('CON Info here');
      expect(result.nextState).toBeUndefined();
    });

    test('should run custom handler returning string', async () => {
      const sb = new StateBuilder('test');
      sb.run(async () => 'Dynamic response').end();
      const handler = buildHandler(sb);
      const result = await handler('', 'session1', {});
      expect(result.response).toBe('END Dynamic response');
    });

    test('should pass through custom handler returning object', async () => {
      const sb = new StateBuilder('test');
      sb.run(async () => ({ response: 'CON Custom', nextState: 'other' }));
      const handler = buildHandler(sb);
      const result = await handler('', 'session1', {});
      expect(result.response).toBe('CON Custom');
      expect(result.nextState).toBe('other');
    });

    test('should save input with string key', async () => {
      const sb = new StateBuilder('test');
      sb.message('Enter phone:').save('phone').next('confirm');
      const handler = buildHandler(sb);
      const result = await handler('254700000000', 'session1', { sessionData: {} });
      expect(result.data).toEqual({ phone: '254700000000' });
    });

    test('should save input with function mapper', async () => {
      const sb = new StateBuilder('test');
      sb.message('Enter amount:')
        .save((input) => ({ amount: parseInt(input, 10) }))
        .next('confirm');
      const handler = buildHandler(sb);
      const result = await handler('500', 'session1', { sessionData: {} });
      expect(result.data).toEqual({ amount: 500 });
    });

    test('should merge saved data with existing session data', async () => {
      const sb = new StateBuilder('test');
      sb.message('Enter name:').save('name').next('confirm');
      const handler = buildHandler(sb);
      const result = await handler('John', 'session1', { sessionData: { phone: '254700000000' } });
      expect(result.data).toEqual({ phone: '254700000000', name: 'John' });
    });

    test('should handle unmatched route with default next state', async () => {
      const sb = new StateBuilder('test');
      sb.message('Menu').on('1').goto('special');
      sb.next('default');
      const handler = buildHandler(sb);
      const result = await handler('9', 'session1', {});
      expect(result.response).toBe('CON Menu');
      expect(result.nextState).toBe('default');
    });

    test('should handle route end() without text using message fallback', async () => {
      const sb = new StateBuilder('test');
      sb.message('Session complete');
      sb.on('1').end();
      const handler = buildHandler(sb);
      const result = await handler('1', 'session1', {});
      expect(result.response).toBe('END Session complete');
    });

    test('should not save data on empty input', async () => {
      const sb = new StateBuilder('test');
      sb.message('Enter:').save('field').next('other');
      const handler = buildHandler(sb);
      const result = await handler('', 'session1', { sessionData: {} });
      expect(result.data).toBeUndefined();
    });

    test('run handler response overridden by route end', async () => {
      const sb = new StateBuilder('test');
      sb.run(async () => 'Prompt\n1. Yes\n2. No');
      sb.on('1').end('Done!');
      const handler = buildHandler(sb);

      // With input matching route
      const result = await handler('1', 'session1', {});
      expect(result.response).toBe('END Done!');
    });

    test('run handler response used when no route matches', async () => {
      const sb = new StateBuilder('test');
      sb.run(async () => 'Prompt\n1. Yes\n2. No');
      sb.on('1').end('Done!');
      const handler = buildHandler(sb);

      // No matching route on empty input
      const result = await handler('', 'session1', {});
      expect(result.response).toBe('CON Prompt\n1. Yes\n2. No');
    });
  });
});
