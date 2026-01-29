/**
 * Tests for Testing Integration (.test() and .inspect())
 */
const { createApp } = require('../../lib/sdk');

describe('SDK Testing Integration', () => {
  describe('.test() method', () => {
    it('should be attached to built machines', () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .start('welcome')
        .build();

      expect(typeof app.test).toBe('function');
    });

    it('should return a USSDTester instance', () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .start('welcome')
        .build();

      const tester = app.test();
      expect(tester).toBeDefined();
      expect(typeof tester.start).toBe('function');
      expect(typeof tester.input).toBe('function');
      expect(typeof tester.expectResponse).toBe('function');
      expect(typeof tester.run).toBe('function');
    });

    it('should allow testing flows', async () => {
      const app = createApp()
        .state('welcome', s => s
          .message('Welcome!\n1. Continue')
          .on('1').goto('next')
        )
        .state('next', s => s.message('Next screen').end())
        .start('welcome')
        .build();

      const tester = app.test({ sessionId: 'test-session' });

      await tester
        .start()
        .expectResponse(/Welcome/)
        .input('1')
        .expectResponse(/Next screen/)
        .run();
    });

    it('should support custom sessionId', async () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .start('welcome')
        .build();

      const tester = app.test({ sessionId: 'custom-session-123' });

      await tester
        .start()
        .expectResponse(/Hello/)
        .run();
    });

    it('should allow expectState assertions', async () => {
      const app = createApp()
        .state('welcome', s => s
          .message('Hi')
          .on('1').goto('menu')
        )
        .state('menu', s => s.message('Menu').end())
        .start('welcome')
        .build();

      const tester = app.test();

      await tester
        .start()
        .input('1')
        .expectState('menu')
        .run();
    });

    it('should fail on incorrect response expectation', async () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .start('welcome')
        .build();

      const tester = app.test();

      await expect(
        tester
          .start()
          .expectResponse(/Goodbye/)
          .run()
      ).rejects.toThrow();
    });
  });

  describe('.inspect() method', () => {
    it('should be attached to built machines', () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .start('welcome')
        .build();

      expect(typeof app.inspect).toBe('function');
    });

    it('should return a StateInspector instance', () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .start('welcome')
        .build();

      const inspector = app.inspect();
      expect(inspector).toBeDefined();
      expect(typeof inspector.getSummary).toBe('function');
      expect(typeof inspector.validate).toBe('function');
    });

    it('should provide state machine summary', () => {
      const app = createApp()
        .state('welcome', s => s.message('Welcome').on('1').goto('menu'))
        .state('menu', s => s.message('Menu').on('1').goto('action'))
        .state('action', s => s.message('Done').end())
        .start('welcome')
        .build();

      const inspector = app.inspect();
      const summary = inspector.getSummary();

      expect(summary.totalStates).toBe(3);
      expect(summary.initialState).toBe('welcome');
    });

    it('should generate ASCII diagram', () => {
      const app = createApp()
        .state('a', s => s.message('A').on('1').goto('b'))
        .state('b', s => s.message('B').end())
        .start('a')
        .build();

      const inspector = app.inspect();
      const diagram = inspector.toAsciiDiagram();

      expect(typeof diagram).toBe('string');
      expect(diagram.length).toBeGreaterThan(0);
    });

    it('should validate state machine configuration', () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .start('welcome')
        .build();

      const inspector = app.inspect();
      const result = inspector.validate();

      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should get state info', () => {
      const app = createApp()
        .state('welcome', s => s
          .message('Hello')
          .validate(() => {})
          .onEnter(() => {})
          .end()
        )
        .start('welcome')
        .build();

      const inspector = app.inspect();
      const stateInfo = inspector.getStateInfo('welcome');

      expect(stateInfo).toBeDefined();
      expect(stateInfo.hasHandler).toBe(true);
      expect(stateInfo.hasValidator).toBe(true);
    });
  });

  describe('Integration with SDK features', () => {
    it('should test menu-based states', async () => {
      const app = createApp()
        .state('main', s => s
          .menu('Select', [
            { key: '1', label: 'Option A', end: 'Selected A' },
            { key: '2', label: 'Option B', end: 'Selected B' }
          ])
        )
        .start('main')
        .build();

      await app.test()
        .start()
        .expectResponse(/Select/)
        .expectResponse(/1\. Option A/)
        .input('2')
        .expectResponse(/Selected B/)
        .run();
    });

    it('should test form flows', async () => {
      const app = createApp()
        .form('register', f => f
          .field('name', field => field.prompt('Enter name:'))
          .field('age', field => field.prompt('Enter age:'))
          .onComplete('done')
        )
        .state('done', s => s.message('Registration complete').end())
        .start('register_name')
        .build();

      await app.test()
        .start()
        .expectResponse(/Enter name/)
        .input('John')
        .expectResponse(/Enter age/)
        .input('25')
        .expectResponse(/Registration complete/)
        .run();
    });

    it('should inspect forms', () => {
      const app = createApp()
        .form('data', f => f
          .field('a', field => field.prompt('A:'))
          .field('b', field => field.prompt('B:'))
          .onComplete('end')
        )
        .state('end', s => s.message('End').end())
        .start('data_a')
        .build();

      const inspector = app.inspect();
      const summary = inspector.getSummary();

      // Form creates data_a, data_b states + end state
      expect(summary.totalStates).toBe(3);
    });
  });
});
