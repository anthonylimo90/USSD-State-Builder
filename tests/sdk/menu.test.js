/**
 * Tests for Menu Builder and Default Route (on('*')) functionality
 */
const { createApp } = require('../../lib/sdk');
const { Validators } = require('../../lib/ValidationLibrary');

describe('SDK Menu Builder', () => {
  describe('menu() method', () => {
    it('should create a menu with auto-generated message', async () => {
      const app = createApp()
        .state('main', s => s
          .menu('Welcome', [
            { key: '1', label: 'Option 1', goto: 'opt1' },
            { key: '2', label: 'Option 2', goto: 'opt2' }
          ])
        )
        .state('opt1', s => s.message('Option 1 selected').end())
        .state('opt2', s => s.message('Option 2 selected').end())
        .start('main')
        .build();

      const response = await app.processInput('session1', '');
      expect(response).toBe('CON Welcome\n1. Option 1\n2. Option 2');
    });

    it('should route to correct state based on input', async () => {
      const app = createApp()
        .state('main', s => s
          .menu('Select', [
            { key: '1', label: 'First', goto: 'first' },
            { key: '2', label: 'Second', goto: 'second' }
          ])
        )
        .state('first', s => s.message('First choice').end())
        .state('second', s => s.message('Second choice').end())
        .start('main')
        .build();

      await app.processInput('session1', '');
      const response = await app.processInput('session1', '1');
      expect(response).toBe('END First choice');
    });

    it('should handle end action in menu items', async () => {
      const app = createApp()
        .state('main', s => s
          .menu('Menu', [
            { key: '1', label: 'Continue', goto: 'next' },
            { key: '2', label: 'Exit', end: 'Goodbye!' }
          ])
        )
        .state('next', s => s.message('Next screen').end())
        .start('main')
        .build();

      await app.processInput('session1', '');
      const response = await app.processInput('session1', '2');
      expect(response).toBe('END Goodbye!');
    });

    it('should handle reply action in menu items', async () => {
      const app = createApp()
        .state('main', s => s
          .menu('Menu', [
            { key: '1', label: 'Info', reply: 'Here is some info' },
            { key: '2', label: 'Exit', end: 'Bye' }
          ])
        )
        .start('main')
        .build();

      await app.processInput('session1', '');
      const response = await app.processInput('session1', '1');
      expect(response).toBe('CON Here is some info');
    });

    it('should throw error for empty items array', () => {
      expect(() => {
        createApp()
          .state('main', s => s.menu('Title', []))
          .build();
      }).toThrow('Menu items must be a non-empty array');
    });

    it('should throw error for items without key', () => {
      expect(() => {
        createApp()
          .state('main', s => s.menu('Title', [{ label: 'No key' }]))
          .build();
      }).toThrow('Each menu item must have a key and label');
    });

    it('should throw error for items without label', () => {
      expect(() => {
        createApp()
          .state('main', s => s.menu('Title', [{ key: '1' }]))
          .build();
      }).toThrow('Each menu item must have a key and label');
    });

    it('should support custom keys (not just numbers)', async () => {
      const app = createApp()
        .state('main', s => s
          .menu('Select', [
            { key: 'a', label: 'Alpha', end: 'A selected' },
            { key: 'b', label: 'Beta', end: 'B selected' }
          ])
        )
        .start('main')
        .build();

      await app.processInput('session1', '');
      const response = await app.processInput('session1', 'a');
      expect(response).toBe('END A selected');
    });
  });

  describe('Default route on("*")', () => {
    it('should match wildcard when no exact route matches', async () => {
      const app = createApp()
        .state('prompt', s => s
          .message('Enter anything:')
          .on('*').goto('process')
        )
        .state('process', s => s
          .run(async (input, sid, ctx) => `You entered: ${ctx.sessionData || 'nothing'}`)
          .end()
        )
        .start('prompt')
        .build();

      await app.processInput('session1', '');
      const response = await app.processInput('session1', 'hello world');
      expect(response).toBe('END You entered: nothing');
    });

    it('should prefer exact routes over wildcard', async () => {
      const app = createApp()
        .state('main', s => s
          .message('Enter input:')
          .on('1').end('One')
          .on('2').end('Two')
          .on('*').end('Other')
        )
        .start('main')
        .build();

      await app.processInput('session1', '');

      // Exact match
      let response = await app.processInput('session1', '1');
      expect(response).toBe('END One');

      // Wildcard match
      await app.processInput('session2', '');
      response = await app.processInput('session2', '999');
      expect(response).toBe('END Other');
    });

    it('should allow wildcard with goto', async () => {
      const app = createApp()
        .state('input', s => s
          .message('Enter name:')
          .on('*').goto('greet')
        )
        .state('greet', s => s
          .run(async () => 'Hello!')
          .end()
        )
        .start('input')
        .build();

      await app.processInput('session1', '');
      const response = await app.processInput('session1', 'John');
      expect(response).toBe('END Hello!');
    });

    it('should allow wildcard with reply', async () => {
      const app = createApp()
        .state('prompt', s => s
          .message('Type something:')
          .on('quit').end('Bye')
          .on('*').reply('Please type "quit" to exit')
        )
        .start('prompt')
        .build();

      await app.processInput('session1', '');
      const response = await app.processInput('session1', 'random');
      expect(response).toBe('CON Please type "quit" to exit');
    });

    it('should work with menu when wildcard is added', async () => {
      const app = createApp()
        .state('main', s => s
          .menu('Select', [
            { key: '1', label: 'Option A', end: 'A' },
            { key: '2', label: 'Option B', end: 'B' }
          ])
          .on('*').reply('Invalid option, try again')
        )
        .start('main')
        .build();

      await app.processInput('session1', '');
      const response = await app.processInput('session1', '5');
      expect(response).toBe('CON Invalid option, try again');
    });
  });

  describe('Auto menuOption validator', () => {
    it('should not auto-add validator when wildcard route exists', async () => {
      const app = createApp()
        .state('main', s => s
          .menu('Menu', [
            { key: '1', label: 'One', end: 'One' }
          ])
          .on('*').end('Caught by wildcard')
        )
        .start('main')
        .build();

      await app.processInput('session1', '');
      // Without auto-validator, invalid input should hit wildcard
      const response = await app.processInput('session1', '99');
      expect(response).toBe('END Caught by wildcard');
    });
  });
});
