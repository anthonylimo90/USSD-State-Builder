const RouteBuilder = require('../../lib/sdk/RouteBuilder');
const StateBuilder = require('../../lib/sdk/StateBuilder');

describe('RouteBuilder', () => {
  let parent;

  beforeEach(() => {
    parent = new StateBuilder('test');
  });

  test('should store input value', () => {
    const route = new RouteBuilder(parent, '1');
    expect(route._input).toBe('1');
  });

  test('goto() should set target and return parent', () => {
    const route = new RouteBuilder(parent, '1');
    const result = route.goto('nextState');
    expect(route._target).toBe('nextState');
    expect(result).toBe(parent);
  });

  test('reply() should set response and return parent', () => {
    const route = new RouteBuilder(parent, '1');
    const result = route.reply('Hello!');
    expect(route._response).toBe('Hello!');
    expect(route._isEnd).toBe(false);
    expect(result).toBe(parent);
  });

  test('end() with text should set response and mark as end', () => {
    const route = new RouteBuilder(parent, '1');
    const result = route.end('Goodbye!');
    expect(route._response).toBe('Goodbye!');
    expect(route._isEnd).toBe(true);
    expect(result).toBe(parent);
  });

  test('end() without text should mark as end with null response', () => {
    const route = new RouteBuilder(parent, '1');
    const result = route.end();
    expect(route._response).toBe(null);
    expect(route._isEnd).toBe(true);
    expect(result).toBe(parent);
  });
});
