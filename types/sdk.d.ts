/**
 * USSD State Builder SDK TypeScript Definitions
 *
 * Fluent/chainable builder API for defining USSD applications.
 */

import {
  USSDStateMachine,
  StorageAdapter,
  StateHandlerResult,
  StateContext,
  MiddlewareHook,
  MiddlewareFunction,
  LifecycleHooks,
  ValidatorFunction,
  Logger
} from './index';

/**
 * Route builder for defining input-to-state routing
 */
export class RouteBuilder {
  /**
   * Transition to another state when this input is received
   * @param stateName - Target state name
   * @returns Parent StateBuilder for chaining
   */
  goto(stateName: string): StateBuilder;

  /**
   * Send a response without transitioning (stays in same state)
   * @param text - Response text (CON prefix auto-added)
   * @returns Parent StateBuilder for chaining
   */
  reply(text: string): StateBuilder;

  /**
   * Send a terminal response for this route
   * @param text - Response text (END prefix auto-added)
   * @returns Parent StateBuilder for chaining
   */
  end(text?: string): StateBuilder;
}

/**
 * Handler function that returns a string response or a full result object
 */
export type SDKHandler = (
  input: string,
  sessionId: string,
  context: StateContext
) => Promise<string | StateHandlerResult> | string | StateHandlerResult;

/**
 * Save mapper function
 */
export type SaveMapper = (
  input: string,
  context: StateContext
) => Record<string, any>;

/**
 * State builder for defining individual USSD states
 */
export class StateBuilder {
  /**
   * Set a static display message for this state
   * @param text - Message text (no CON/END prefix needed)
   */
  message(text: string): StateBuilder;

  /**
   * Define input-based routing
   * @param input - Input value to match
   */
  on(input: string): RouteBuilder;

  /**
   * Set the default next state
   * @param stateName - Target state name
   */
  next(stateName: string): StateBuilder;

  /**
   * Mark this state as terminal (END prefix)
   */
  end(): StateBuilder;

  /**
   * Set a custom async handler
   * @param handler - Handler function returning string or StateHandlerResult
   */
  run(handler: SDKHandler): StateBuilder;

  /**
   * Attach a validator function
   * @param fn - Validator function (from Validators.* or custom)
   */
  validate(fn: ValidatorFunction): StateBuilder;

  /**
   * Map input to session data
   * @param keyOrMapper - String key to save input as, or function returning data object
   */
  save(keyOrMapper: string | SaveMapper): StateBuilder;

  /**
   * Lifecycle hook called when entering this state
   */
  onEnter(fn: (sessionId: string) => Promise<void> | void): StateBuilder;

  /**
   * Lifecycle hook called when exiting this state
   */
  onExit(fn: (sessionId: string) => Promise<void> | void): StateBuilder;
}

/**
 * State configurator callback
 */
export type StateConfigurator = (stateBuilder: StateBuilder) => void;

/**
 * Top-level application builder
 */
export class AppBuilder {
  /**
   * Define a state via callback
   * @param name - State name
   * @param configurator - State configurator callback
   */
  state(name: string, configurator: StateConfigurator): AppBuilder;

  /**
   * Set the initial state (defaults to first state defined)
   * @param name - State name to start from
   */
  start(name: string): AppBuilder;

  /**
   * Set the storage adapter
   * @param adapter - Storage adapter instance
   */
  storage(adapter: StorageAdapter): AppBuilder;

  /**
   * Set session timeout
   * @param seconds - Timeout in seconds
   */
  timeout(seconds: number): AppBuilder;

  /**
   * Register middleware
   * @param hook - Middleware hook name
   * @param fn - Middleware function
   */
  use(hook: MiddlewareHook, fn: MiddlewareFunction): AppBuilder;

  /**
   * Set lifecycle hooks
   * @param obj - Hooks object
   */
  hooks(obj: Partial<LifecycleHooks>): AppBuilder;

  /**
   * Enable or disable back navigation
   * @param enabled - Whether to enable back navigation (default: true)
   */
  backNavigation(enabled?: boolean): AppBuilder;

  /**
   * Set custom logger
   * @param logger - Logger instance or null to disable
   */
  logger(logger: Logger | null): AppBuilder;

  /**
   * Set maximum input length
   * @param length - Max input length (0 to disable)
   */
  maxInputLength(length: number): AppBuilder;

  /**
   * Compile and return a USSDStateMachine instance
   */
  build(): USSDStateMachine;
}

/**
 * Create a new USSD application builder
 * @returns New AppBuilder instance
 */
export function createApp(): AppBuilder;
