const AppBuilder = require('../../lib/sdk/AppBuilder');
const USSDStateMachine = require('../../lib/USSDStateMachine');
const InMemoryStorage = require('../../lib/InMemoryStorage');

describe('AppBuilder', () => {
  test('should create an AppBuilder with defaults', () => {
    const builder = new AppBuilder();
    expect(builder._states.size).toBe(0);
    expect(builder._initialState).toBeNull();
  });

  test('state() should add a state and return this', () => {
    const builder = new AppBuilder();
    const result = builder.state('welcome', s => s.message('Hi').end());
    expect(result).toBe(builder);
    expect(builder._states.size).toBe(1);
    expect(builder._states.has('welcome')).toBe(true);
  });

  test('start() should set initial state', () => {
    const builder = new AppBuilder();
    builder.state('a', s => s.message('A').end());
    const result = builder.start('a');
    expect(result).toBe(builder);
    expect(builder._initialState).toBe('a');
  });

  test('storage() should set storage adapter', () => {
    const builder = new AppBuilder();
    const storage = new InMemoryStorage();
    const result = builder.storage(storage);
    expect(result).toBe(builder);
    expect(builder._storageAdapter).toBe(storage);
  });

  test('timeout() should set timeout', () => {
    const builder = new AppBuilder();
    const result = builder.timeout(600);
    expect(result).toBe(builder);
    expect(builder._timeoutSeconds).toBe(600);
  });

  test('use() should register middleware', () => {
    const builder = new AppBuilder();
    const fn = async (ctx, next) => { await next(); };
    const result = builder.use('beforeProcess', fn);
    expect(result).toBe(builder);
    expect(builder._middlewares).toHaveLength(1);
    expect(builder._middlewares[0]).toEqual({ hook: 'beforeProcess', fn });
  });

  test('hooks() should set lifecycle hooks', () => {
    const builder = new AppBuilder();
    const onEnter = () => {};
    const result = builder.hooks({ onStateEnter: onEnter });
    expect(result).toBe(builder);
    expect(builder._hooks.onStateEnter).toBe(onEnter);
  });

  test('backNavigation() should enable/disable', () => {
    const builder = new AppBuilder();
    builder.backNavigation(false);
    expect(builder._backNavigation).toBe(false);
    builder.backNavigation();
    expect(builder._backNavigation).toBe(true);
  });

  test('logger() should set logger', () => {
    const builder = new AppBuilder();
    builder.logger(null);
    expect(builder._logger).toBeNull();
  });

  test('maxInputLength() should set max input length', () => {
    const builder = new AppBuilder();
    builder.maxInputLength(200);
    expect(builder._maxInputLength).toBe(200);
  });

  test('build() should return a USSDStateMachine instance', () => {
    const machine = new AppBuilder()
      .state('welcome', s => s.message('Hello').end())
      .start('welcome')
      .logger(null)
      .build();

    expect(machine).toBeInstanceOf(USSDStateMachine);
    expect(machine.initialState).toBe('welcome');
  });

  test('build() should default initial state to first state defined', () => {
    const machine = new AppBuilder()
      .state('first', s => s.message('First').end())
      .state('second', s => s.message('Second').end())
      .logger(null)
      .build();

    expect(machine.initialState).toBe('first');
  });

  test('build() should throw when no states defined', () => {
    expect(() => new AppBuilder().build()).toThrow('At least one state must be defined');
  });

  test('build() should throw when initial state not found', () => {
    expect(() =>
      new AppBuilder()
        .state('a', s => s.message('A').end())
        .start('nonexistent')
        .build()
    ).toThrow('Initial state "nonexistent" not found');
  });

  test('build() should pass storage adapter to machine', () => {
    const storage = new InMemoryStorage();
    const machine = new AppBuilder()
      .state('welcome', s => s.message('Hi').end())
      .storage(storage)
      .logger(null)
      .build();

    expect(machine.storage).toBe(storage);
  });

  test('build() should pass timeout to machine', () => {
    const machine = new AppBuilder()
      .state('welcome', s => s.message('Hi').end())
      .timeout(600)
      .logger(null)
      .build();

    expect(machine.timeout).toBe(600);
  });

  test('build() should pass hooks to machine', () => {
    const onEnter = () => {};
    const machine = new AppBuilder()
      .state('welcome', s => s.message('Hi').end())
      .hooks({ onStateEnter: onEnter })
      .logger(null)
      .build();

    expect(machine.hooks.onStateEnter).toBe(onEnter);
  });

  test('build() should pass backNavigation setting', () => {
    const machine = new AppBuilder()
      .state('welcome', s => s.message('Hi').end())
      .backNavigation(false)
      .logger(null)
      .build();

    expect(machine.enableBackNavigation).toBe(false);
  });

  test('build() should compile validator into state config', () => {
    const validator = () => {};
    const machine = new AppBuilder()
      .state('input', s => s.message('Enter:').validate(validator).next('done'))
      .state('done', s => s.message('Done').end())
      .logger(null)
      .build();

    expect(machine.states['input'].validator).toBe(validator);
  });

  test('build() should compile onEnter/onExit into state config', () => {
    const onEnter = () => {};
    const onExit = () => {};
    const machine = new AppBuilder()
      .state('test', s => s.message('Test').onEnter(onEnter).onExit(onExit).end())
      .logger(null)
      .build();

    expect(machine.states['test'].onEnter).toBe(onEnter);
    expect(machine.states['test'].onExit).toBe(onExit);
  });
});
