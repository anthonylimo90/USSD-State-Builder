const StateBuilder = require('../../lib/sdk/StateBuilder');
const RouteBuilder = require('../../lib/sdk/RouteBuilder');

describe('StateBuilder', () => {
  let sb;

  beforeEach(() => {
    sb = new StateBuilder('testState');
  });

  test('should store state name', () => {
    expect(sb._name).toBe('testState');
  });

  test('message() should set message and return this', () => {
    const result = sb.message('Welcome!');
    expect(sb._message).toBe('Welcome!');
    expect(result).toBe(sb);
  });

  test('on() should create a RouteBuilder and return it', () => {
    const route = sb.on('1');
    expect(route).toBeInstanceOf(RouteBuilder);
    expect(route._input).toBe('1');
    expect(sb._routes).toHaveLength(1);
    expect(sb._routes[0]).toBe(route);
  });

  test('multiple on() calls should create multiple routes', () => {
    sb.on('1').goto('a');
    sb.on('2').goto('b');
    expect(sb._routes).toHaveLength(2);
    expect(sb._routes[0]._input).toBe('1');
    expect(sb._routes[1]._input).toBe('2');
  });

  test('next() should set next state and return this', () => {
    const result = sb.next('nextState');
    expect(sb._nextState).toBe('nextState');
    expect(result).toBe(sb);
  });

  test('end() should mark as terminal and return this', () => {
    const result = sb.end();
    expect(sb._isEnd).toBe(true);
    expect(result).toBe(sb);
  });

  test('run() should set custom handler and return this', () => {
    const handler = async () => 'response';
    const result = sb.run(handler);
    expect(sb._handler).toBe(handler);
    expect(result).toBe(sb);
  });

  test('validate() should set validator and return this', () => {
    const validator = () => {};
    const result = sb.validate(validator);
    expect(sb._validator).toBe(validator);
    expect(result).toBe(sb);
  });

  test('save() with string key should set save key', () => {
    const result = sb.save('phone');
    expect(sb._saveKey).toBe('phone');
    expect(result).toBe(sb);
  });

  test('save() with function should set save mapper', () => {
    const mapper = (input) => ({ phone: input });
    sb.save(mapper);
    expect(sb._saveKey).toBe(mapper);
  });

  test('onEnter() should set enter hook and return this', () => {
    const fn = () => {};
    const result = sb.onEnter(fn);
    expect(sb._onEnterFn).toBe(fn);
    expect(result).toBe(sb);
  });

  test('onExit() should set exit hook and return this', () => {
    const fn = () => {};
    const result = sb.onExit(fn);
    expect(sb._onExitFn).toBe(fn);
    expect(result).toBe(sb);
  });

  test('chaining should work across all methods', () => {
    const validator = () => {};
    const result = sb
      .message('Enter phone:')
      .validate(validator)
      .save('phone')
      .next('confirm');
    expect(result).toBe(sb);
    expect(sb._message).toBe('Enter phone:');
    expect(sb._validator).toBe(validator);
    expect(sb._saveKey).toBe('phone');
    expect(sb._nextState).toBe('confirm');
  });

  test('on() chaining should return to parent', () => {
    const result = sb
      .message('Choose:\n1. A\n2. B')
      .on('1').goto('a')
      .on('2').goto('b');
    // The final .goto() returns sb, so .on() is called on sb
    expect(sb._routes).toHaveLength(2);
  });
});
