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
 * Menu item configuration
 */
export interface MenuItem {
  /** Input key for this option (e.g., '1', '2') */
  key: string;
  /** Display label for this option */
  label: string;
  /** State to transition to */
  goto?: string;
  /** End session with this message */
  end?: string;
  /** Reply without transitioning */
  reply?: string;
}

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
   * Create a numbered menu from title and items
   * Auto-generates message and routes for each item
   * @param title - Menu title/header
   * @param items - Menu items with key, label, and action
   */
  menu(title: string, items: MenuItem[]): StateBuilder;

  /**
   * Define input-based routing
   * @param input - Input value to match ('*' for wildcard/catch-all)
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

  /**
   * Configure a dynamic menu that fetches items at runtime
   * @param fetcher - Async function returning array of items
   * @param options - Configuration options
   */
  dynamicMenu<T = any>(
    fetcher: DynamicMenuFetcher<T>,
    options?: DynamicMenuOptions<T>
  ): StateBuilder;
}

/**
 * Pagination options for dynamic menus
 */
export interface PaginationOptions {
  /** Items per page (default: 5) */
  pageSize?: number;
  /** Key to show more items (default: '99') */
  moreKey?: string;
  /** Key to go to previous page (default: '98') */
  backKey?: string;
  /** Label for more option (default: 'More') */
  moreLabel?: string;
  /** Label for back option (default: 'Back') */
  backLabel?: string;
}

/**
 * Refresh options for dynamic menus
 */
export interface RefreshOptions {
  /** Key to trigger refresh (default: '0') */
  key?: string;
  /** Label for refresh option (default: 'Refresh') */
  label?: string;
}

/**
 * Options for the convenience dynamicMenu() method
 */
export interface DynamicMenuOptions<T = any> {
  /** Function to format item for display */
  format?: (item: T, index: number) => string;
  /** Function to extract value from selected item */
  value?: (item: T) => any;
  /** Header text displayed above menu items */
  header?: string;
  /** Items per page (enables pagination) */
  pageSize?: number;
  /** Key to show more items (default: '99') */
  moreKey?: string;
  /** Key to go to previous page (default: '98') */
  backKey?: string;
  /** Label for more option (default: 'More') */
  moreLabel?: string;
  /** Label for back option (default: 'Back') */
  backLabel?: string;
  /** Empty data configuration */
  empty?: {
    message: string;
    action?: 'end' | 'continue';
  };
  /** Error handler for fetch failures */
  onError?: (error: Error, sessionId: string, context: StateContext) => string | StateHandlerResult;
  /** Maximum items to store in session (prevents memory issues with large datasets) */
  maxItems?: number;
  /** Refresh configuration to allow re-fetching data */
  refresh?: RefreshOptions;
}

/**
 * Data fetcher function type
 */
export type DynamicMenuFetcher<T = any> = (
  sessionId: string,
  context: StateContext
) => Promise<T[]> | T[];

/**
 * Builder for dynamic/reactive USSD menus
 */
export class DynamicMenuBuilder<T = any> {
  /**
   * Set the data fetcher function
   */
  fetch(fn: DynamicMenuFetcher<T>): DynamicMenuBuilder<T>;

  /**
   * Set the item formatter function
   */
  format(fn: (item: T, index: number) => string): DynamicMenuBuilder<T>;

  /**
   * Set the value extractor function
   */
  value(fn: (item: T) => any): DynamicMenuBuilder<T>;

  /**
   * Set the menu header text
   */
  header(text: string): DynamicMenuBuilder<T>;

  /**
   * Enable pagination with options
   */
  paginated(options?: PaginationOptions): DynamicMenuBuilder<T>;

  /**
   * Configure empty data handling
   */
  onEmpty(message: string, action?: 'end' | 'continue'): DynamicMenuBuilder<T>;

  /**
   * Set error handler for fetch failures
   */
  onError(handler: (error: Error, sessionId: string, context: StateContext) => string | StateHandlerResult): DynamicMenuBuilder<T>;

  /**
   * Limit maximum items stored in session to prevent memory issues
   * @param limit - Maximum items to store (recommended: 50-100 for USSD)
   */
  maxItems(limit: number): DynamicMenuBuilder<T>;

  /**
   * Enable data refresh capability
   * @param options - Refresh configuration
   */
  refreshable(options?: RefreshOptions): DynamicMenuBuilder<T>;

  /**
   * Build and return the handler function
   */
  build(): SDKHandler;
}

/**
 * Factory functions for DynamicMenuBuilder
 */
export namespace DynamicMenu {
  /**
   * Create a new DynamicMenuBuilder
   */
  function create<T = any>(): DynamicMenuBuilder<T>;

  /**
   * Create a DynamicMenuBuilder with fetcher already set
   */
  function from<T = any>(fetcher: DynamicMenuFetcher<T>): DynamicMenuBuilder<T>;
}

/**
 * State configurator callback
 */
export type StateConfigurator = (stateBuilder: StateBuilder) => void;

/**
 * Field builder for form fields
 */
export class FieldBuilder {
  /**
   * Set the prompt message for this field
   */
  prompt(text: string): FieldBuilder;

  /**
   * Attach a validator function
   */
  validate(fn: ValidatorFunction): FieldBuilder;

  /**
   * Transform the input before saving
   */
  transform(fn: (input: string) => any): FieldBuilder;
}

/**
 * Confirm step builder for form confirmation
 */
export class ConfirmStepBuilder {
  /**
   * Set input that triggers confirmation
   */
  onConfirm(input: string): ConfirmStepBuilder;

  /**
   * Set input that triggers cancellation
   */
  onCancel(input: string): ConfirmStepBuilder;

  /**
   * End session with message
   */
  end(message: string): ConfirmStepBuilder;

  /**
   * Go to another state
   */
  goto(stateName: string): ConfirmStepBuilder;
}

/**
 * Field configurator callback
 */
export type FieldConfigurator = (fieldBuilder: FieldBuilder) => void;

/**
 * Form builder for multi-step data collection
 */
export class FormBuilder {
  /**
   * Add a field to the form
   */
  field(name: string, configurator: FieldConfigurator): FormBuilder;

  /**
   * Add a confirmation step
   */
  confirm(renderer: (context: StateContext) => string): ConfirmStepBuilder;

  /**
   * Set the state to transition to after form completion
   */
  onComplete(stateName: string): FormBuilder;
}

/**
 * Form configurator callback
 */
export type FormConfigurator = (formBuilder: FormBuilder) => void;

/**
 * Logging middleware options
 */
export interface LoggingOptions {
  logger?: (message: string) => void;
  logInput?: boolean;
  logResponse?: boolean;
  logTiming?: boolean;
}

/**
 * Rate limit middleware options
 */
export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
  message?: string;
}

/**
 * Sanitization middleware options
 */
export interface SanitizeOptions {
  maxLength?: number;
  trim?: boolean;
  removeSpecialChars?: boolean;
}

/**
 * Metrics middleware options
 */
export interface MetricsOptions {
  bufferSize?: number;
}

/**
 * Session timeout middleware options
 */
export interface SessionTimeoutOptions {
  warningThreshold?: number;
  warningMessage?: string;
}

/**
 * Extended USSDStateMachine with SDK additions
 */
export interface SDKStateMachine extends USSDStateMachine {
  /**
   * Create a tester for this state machine
   */
  test(options?: { sessionId?: string }): import('./index').USSDTester;

  /**
   * Create an inspector for this state machine
   */
  inspect(): import('./index').StateInspector;

  /**
   * Cleanup middleware resources (rate limiter intervals, etc.)
   */
  cleanup(): void;

  /**
   * Get metrics (if metrics middleware is enabled)
   */
  getMetrics?(): {
    totalRequests: number;
    totalErrors: number;
    errorRate: string;
    requestsByState: Record<string, number>;
    averageResponseTime: string;
  };

  /**
   * Reset metrics (if metrics middleware is enabled)
   */
  resetMetrics?(): void;
}

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
   * Define a multi-step form/wizard
   * @param name - Form name (used as prefix for generated states)
   * @param configurator - Form configurator callback
   */
  form(name: string, configurator: FormConfigurator): AppBuilder;

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
   * Add logging middleware
   */
  logging(options?: LoggingOptions): AppBuilder;

  /**
   * Add rate limiting middleware
   */
  rateLimit(options?: RateLimitOptions): AppBuilder;

  /**
   * Add input sanitization middleware
   */
  sanitize(options?: SanitizeOptions): AppBuilder;

  /**
   * Add metrics collection middleware
   */
  metrics(options?: MetricsOptions): AppBuilder;

  /**
   * Add session timeout warning middleware
   */
  sessionTimeout(options?: SessionTimeoutOptions): AppBuilder;

  /**
   * Compile and return a USSDStateMachine instance
   */
  build(): SDKStateMachine;
}

/**
 * Create a new USSD application builder
 * @returns New AppBuilder instance
 */
export function createApp(): AppBuilder;

// Re-export form builder classes
export { FormBuilder, FieldBuilder, ConfirmStepBuilder };
