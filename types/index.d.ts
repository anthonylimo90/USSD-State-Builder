export type FieldSensitivity = 'unspecified' | 'public' | 'sensitive' | 'secret';
export interface FlowTransition {
    input?: string;
    to?: string;
    terminal?: boolean;
    kind?: string;
}
export interface StateMetadata {
    terminal?: boolean;
    dynamic?: boolean;
    transitions?: FlowTransition[];
    field?: { name: string; sensitivity?: FieldSensitivity };
    form?: { name: string; role: 'field' | 'confirm' };
}
export interface FlowStateDefinition extends Omit<StateMetadata, 'terminal'> {
    id: string;
    terminal: boolean | null;
    dynamic: boolean;
    transitions: FlowTransition[];
    localInputKeys: string[];
}
export interface FlowDefinition {
    schemaVersion: 1;
    source: 'sdk' | 'traditional';
    flowVersion: string | null;
    initialState: string;
    navigation: { backKey: '0' | null };
    coverage: 'complete' | 'partial';
    states: Record<string, FlowStateDefinition>;
}
export interface FlowVersionOptions {
    previousFlows?: USSDStateMachine[];
    restartResponse?: string;
}

/**
 * USSD State Machine TypeScript Definitions
 */

/**
 * Custom error class for handling input validation errors
 */
export class ValidationError extends Error {
    name: 'ValidationError';
    constructor(message: string);
}

/**
 * Result returned by a state handler
 */
export interface StateHandlerResult {
    /** The USSD response to send back (CON for continue, END for terminate) */
    response: string;
    /** The next state to transition to */
    nextState?: string;
    /** Navigate to the previous state */
    previousState?: boolean;
    /** Data to store in the session */
    data?: Record<string, any>;
}

/**
 * State handler function type
 */
export type StateHandler = (
    input: string,
    sessionId: string,
    context?: StateContext
) => Promise<StateHandlerResult> | StateHandlerResult;

/**
 * State validator function type
 */
export type StateValidator = (input: string) => Promise<void> | void;

/**
 * Context passed to state handlers
 */
export interface StateContext {
    signal?: AbortSignal;
    deadlineAt?: number;
    turn?: TurnContext;
    /** Current session data */
    sessionData?: Record<string, any>;
    /** Previous state (if available) */
    previousState?: string;
    /** Language preference */
    language?: string;
    /** State currently being handled or rendered */
    currentState?: string;
    /** True when a state is rendered again after back navigation */
    isReentry?: boolean;
}

/**
 * Configuration for a single state
 */
export interface StateConfig {
    metadata?: StateMetadata;
    localInputKeys?: string[];
    /** Handler function that processes input and returns response */
    handler: StateHandler;
    /** Optional validator function to validate input before processing */
    validator?: StateValidator;
    /** Called when entering this state */
    onEnter?: (sessionId: string) => Promise<void> | void;
    /** Called when exiting this state */
    onExit?: (sessionId: string) => Promise<void> | void;
}

/**
 * Session data structure
 */
export interface SessionData {
    /** Current state */
    state: string;
    /** Session expiration timestamp */
    expiresAt: number;
    /** Custom session data */
    data?: Record<string, any>;
    /** State history for back navigation */
    stateHistory?: string[];
}

/**
 * Storage interface for session management
 */
export interface StorageAdapter {
    /** Get the current state for a session */
    getState(sessionId: string): Promise<string | null>;
    /** Set the state for a session */
    setState(sessionId: string, state: string, timeout: number): Promise<void>;
    /** Get custom data for a session */
    getData(sessionId: string): Promise<Record<string, any> | null>;
    /** Set custom data for a session */
    setData(sessionId: string, data: Record<string, any>, timeout: number): Promise<void>;
    /** Serialize a complete session operation when supported by the adapter. */
    withSessionLock?<T>(sessionId: string, fn: () => Promise<T>): Promise<T>;
    /** Get the full session object */
    getSession?(sessionId: string): Promise<SessionData | null>;
    /** Set the full session object */
    setSession?(sessionId: string, session: SessionData): Promise<void>;
    /** Get state history for a session */
    getStateHistory?(sessionId: string): Promise<string[]>;
    /** Push state to history */
    pushStateHistory?(sessionId: string, state: string): Promise<void>;
    /** Pop state from history */
    popStateHistory?(sessionId: string): Promise<string | undefined>;
    /** Clean up expired sessions */
    cleanup?(): void | Promise<void | number>;
    /** Close storage connection */
    close?(): Promise<void>;
}

/**
 * Lifecycle hooks for the state machine
 */
export interface LifecycleHooks {
    /** Called when entering any state */
    onStateEnter?: (state: string, sessionId: string) => Promise<void> | void;
    /** Called when exiting any state */
    onStateExit?: (state: string, sessionId: string) => Promise<void> | void;
    /** Called when an error occurs */
    onError?: (error: Error, sessionId: string, state: string) => Promise<void> | void;
    /** Called when a session expires */
    onSessionExpire?: (sessionId: string) => Promise<void> | void;
}

/**
 * Logger interface for the state machine
 */
export interface Logger {
    error: (message: string, ...args: any[]) => void;
    warn?: (message: string, ...args: any[]) => void;
    info?: (message: string, ...args: any[]) => void;
    debug?: (message: string, ...args: any[]) => void;
}

/**
 * Configuration for the USSD State Machine
 */
export interface USSDConfig extends FlowVersionOptions {
    flowVersion?: string;
    /** The initial state when a new session starts */
    initialState: string;
    /** Session timeout in seconds (default: 300) */
    timeout?: number;
    /** Map of state names to state configurations */
    states: Record<string, StateConfig>;
    /** Custom storage adapter (default: InMemoryStorage) */
    storage?: StorageAdapter;
    /** Enable back navigation support */
    enableBackNavigation?: boolean;
    /** Lifecycle hooks */
    hooks?: LifecycleHooks;
    /** Custom logger (default: console). Set to null to disable logging. */
    logger?: Logger | null;
}

/**
 * Options for processing input
 */
export interface ProcessInputOptions {
    signal?: AbortSignal;
    deadlineAt?: number;
    /** Language preference for the session */
    language?: string;
}

/**
 * Main USSD State Machine class
 */
export class USSDStateMachine {
    readonly flowVersion: string | null;
    getFlowDefinition(): FlowDefinition;
    prepareTurn(sessionId: string, input: string, options?: ProcessInputOptions & {
        session?: TurnSessionSnapshot | null; sessionData?: Record<string, any>; turn?: TurnContext;
    }): Promise<PreparedTurn>;
    /** State configurations */
    states: Record<string, StateConfig>;
    /** Initial state */
    initialState: string;
    /** Session timeout in seconds */
    timeout: number;
    /** Storage adapter */
    storage: StorageAdapter;
    /** Whether back navigation is enabled */
    enableBackNavigation: boolean;
    /** Lifecycle hooks */
    hooks?: LifecycleHooks;
    /** Logger instance (null if logging is disabled) */
    logger: Logger | null;

    /**
     * Create a new USSD State Machine
     * @param config - Configuration object
     */
    constructor(config: USSDConfig);

    /**
     * Process user input and return the appropriate response
     * @param sessionId - Unique session identifier
     * @param input - User input string
     * @param options - Optional processing options
     * @returns USSD response string
     */
    processInput(sessionId: string, input: string, options?: ProcessInputOptions): Promise<string>;

    /** Observe one completed turn without changing its response. */
    useTurnObserver(observer: (turn: TurnObservation) => void): this;

    /**
     * Get session data for a given session ID
     * @param sessionId - Unique session identifier
     * @returns Session data object or null
     */
    getSessionData(sessionId: string): Promise<Record<string, any> | null>;

    /**
     * Navigate to the previous state
     * @param sessionId - Unique session identifier
     * @returns Previous state name or null
     */
    goBack(sessionId: string): Promise<string | null>;

    /**
     * End a session and clean up
     * @param sessionId - Unique session identifier
     */
    endSession(sessionId: string): Promise<void>;
}

/**
 * In-memory storage options
 */
export interface InMemoryStorageOptions {
    /**
     * Maximum number of states to keep in history (default: 20).
     * Prevents unbounded memory growth from repeated back/forward navigation.
     * Set to 0 for unlimited history.
     */
    maxHistorySize?: number;
}

/**
 * In-memory storage implementation
 */
export class InMemoryStorage implements StorageAdapter {
    /** Maximum history size (default: 20) */
    maxHistorySize: number;

    constructor(options?: InMemoryStorageOptions);
    getState(sessionId: string): Promise<string | null>;
    setState(sessionId: string, state: string, timeout: number): Promise<void>;
    getData(sessionId: string): Promise<Record<string, any> | null>;
    setData(sessionId: string, data: Record<string, any>, timeout: number): Promise<void>;
    getSession(sessionId: string): Promise<SessionData | null>;
    setSession(sessionId: string, session: SessionData): Promise<void>;
    getStateHistory(sessionId: string): Promise<string[]>;
    pushStateHistory(sessionId: string, state: string): Promise<void>;
    popStateHistory(sessionId: string): Promise<string | undefined>;
    cleanup(): void;
    /** Get the number of active sessions */
    size(): number;
    /** Clear all sessions */
    clear(): void;
}

/**
 * Redis storage configuration
 */
export interface RedisStorageConfig {
    /** Redis host (default: 'localhost') */
    host?: string;
    /** Redis port (default: 6379) */
    port?: number;
    /** Redis password */
    password?: string;
    /** Redis database number (default: 0) */
    db?: number;
    /** Key prefix for session data (default: 'ussd:') */
    keyPrefix?: string;
    /** Existing Redis client instance */
    client?: any;
    /** Redis URL (alternative to host/port) */
    url?: string;
}

/**
 * Redis storage implementation
 */
export class RedisStorage implements StorageAdapter {
    constructor(config?: RedisStorageConfig);
    getState(sessionId: string): Promise<string | null>;
    setState(sessionId: string, state: string, timeout: number): Promise<void>;
    getData(sessionId: string): Promise<Record<string, any> | null>;
    setData(sessionId: string, data: Record<string, any>, timeout: number): Promise<void>;
    getSession(sessionId: string): Promise<SessionData | null>;
    setSession(sessionId: string, session: SessionData): Promise<void>;
    getStateHistory(sessionId: string): Promise<string[]>;
    pushStateHistory(sessionId: string, state: string): Promise<void>;
    popStateHistory(sessionId: string): Promise<string | undefined>;
    cleanup(): Promise<void>;
    close(): Promise<void>;
}

/**
 * Response builder utilities
 */
export namespace ResponseBuilder {
    /**
     * Create a menu response
     * @param title - Menu title
     * @param options - Array of menu options
     * @returns Formatted CON response
     */
    export function menu(title: string, options: string[]): string;

    /**
     * Create a confirmation prompt
     * @param message - Confirmation message
     * @param yesLabel - Label for yes option (default: 'Yes')
     * @param noLabel - Label for no option (default: 'No')
     * @returns Formatted CON response
     */
    export function confirm(message: string, yesLabel?: string, noLabel?: string): string;

    /**
     * Create an input prompt
     * @param message - Prompt message
     * @returns Formatted CON response
     */
    export function input(message: string): string;

    /**
     * Create an error message with retry option
     * @param message - Error message
     * @param retryMessage - Retry instruction (default: 'Please try again')
     * @returns Formatted CON response
     */
    export function error(message: string, retryMessage?: string): string;

    /**
     * Create a success/end message
     * @param message - Success message
     * @returns Formatted END response
     */
    export function end(message: string): string;

    /**
     * Create a paginated list
     * @param items - Array of items to paginate
     * @param page - Current page number (1-indexed)
     * @param pageSize - Number of items per page (default: 5)
     * @param options - Pagination options
     * @returns Formatted CON response with pagination
     */
    export function paginate(
        items: string[],
        page: number,
        pageSize?: number,
        options?: {
            title?: string;
            moreLabel?: string;
            backLabel?: string;
        }
    ): string;

    /**
     * Create a back navigation option
     * @param message - Message before back option
     * @param backLabel - Label for back option (default: '0. Back')
     * @returns Formatted response with back option
     */
    export function withBack(message: string, backLabel?: string): string;
}

// ==================== Storage Adapters ====================

/**
 * MongoDB storage configuration
 */
export interface MongoDBStorageConfig {
    /** MongoDB connection URI */
    uri?: string;
    /** Database name */
    database?: string;
    /** Collection name */
    collection?: string;
    /** Existing MongoDB client */
    client?: any;
    /** Connection options */
    options?: Record<string, any>;
}

/**
 * MongoDB storage implementation
 */
export class MongoDBStorage implements StorageAdapter {
    constructor(config?: MongoDBStorageConfig);
    getState(sessionId: string): Promise<string | null>;
    setState(sessionId: string, state: string, timeout: number): Promise<void>;
    getData(sessionId: string): Promise<Record<string, any> | null>;
    setData(sessionId: string, data: Record<string, any>, timeout: number): Promise<void>;
    getSession(sessionId: string): Promise<SessionData | null>;
    setSession(sessionId: string, session: SessionData): Promise<void>;
    getStateHistory(sessionId: string): Promise<string[]>;
    pushStateHistory(sessionId: string, state: string): Promise<void>;
    popStateHistory(sessionId: string): Promise<string | undefined>;
    deleteSession(sessionId: string): Promise<void>;
    cleanup(): Promise<void>;
    close(): Promise<void>;
    isConnected(): boolean;
    getStats(): Promise<Record<string, any>>;
}

/**
 * PostgreSQL storage configuration
 */
export interface PostgreSQLStorageConfig {
    /** Database host */
    host?: string;
    /** Database port */
    port?: number;
    /** Database name */
    database?: string;
    /** Database user */
    user?: string;
    /** Database password */
    password?: string;
    /** Connection string */
    connectionString?: string;
    /** Table name */
    table?: string;
    /** Existing pg Pool */
    pool?: any;
    /** Pool configuration */
    poolConfig?: Record<string, any>;
}

/**
 * PostgreSQL storage implementation
 */
export class PostgreSQLStorage implements StorageAdapter {
    constructor(config?: PostgreSQLStorageConfig);
    getState(sessionId: string): Promise<string | null>;
    setState(sessionId: string, state: string, timeout: number): Promise<void>;
    getData(sessionId: string): Promise<Record<string, any> | null>;
    setData(sessionId: string, data: Record<string, any>, timeout: number): Promise<void>;
    getSession(sessionId: string): Promise<SessionData | null>;
    setSession(sessionId: string, session: SessionData): Promise<void>;
    getStateHistory(sessionId: string): Promise<string[]>;
    pushStateHistory(sessionId: string, state: string): Promise<void>;
    popStateHistory(sessionId: string): Promise<string | undefined>;
    deleteSession(sessionId: string): Promise<void>;
    cleanup(): Promise<number>;
    close(): Promise<void>;
    isConnected(): boolean;
    getStats(): Promise<Record<string, any>>;
}

/**
 * Abstract storage interface for custom implementations
 */
export abstract class StorageInterface implements StorageAdapter {
    abstract getState(sessionId: string): Promise<string | null>;
    abstract setState(sessionId: string, state: string, timeout: number): Promise<void>;
    abstract getData(sessionId: string): Promise<Record<string, any> | null>;
    abstract setData(sessionId: string, data: Record<string, any>, timeout: number): Promise<void>;
    getSession(sessionId: string): Promise<SessionData | null>;
    setSession(sessionId: string, session: SessionData): Promise<void>;
    getStateHistory(sessionId: string): Promise<string[]>;
    pushStateHistory(sessionId: string, state: string): Promise<void>;
    popStateHistory(sessionId: string): Promise<string | undefined>;
    deleteSession(sessionId: string): Promise<void>;
    cleanup(): Promise<void>;
    close(): Promise<void>;
    isConnected(): boolean;
    getStats(): Promise<Record<string, any>>;
}

// ==================== Middleware System ====================

/**
 * Middleware execution context
 */
export interface MiddlewareContext {
    signal?: AbortSignal;
    deadlineAt?: number;
    sessionId: string;
    input: string;
    currentState: string;
    sessionData?: Record<string, any>;
    metadata?: Record<string, any>;
    response?: string | null;
    nextState?: string | null;
    blocked?: boolean;
    error?: Error;
}

/**
 * Middleware function type
 */
export type MiddlewareFunction = (
    context: MiddlewareContext,
    next: () => Promise<void>
) => Promise<void>;

/**
 * Middleware hook names
 */
export type MiddlewareHook =
    | 'beforeProcess'
    | 'afterProcess'
    | 'onError'
    | 'onStateChange'
    | 'onSessionStart'
    | 'onSessionEnd';

/**
 * Middleware manager for registering and executing middleware
 */
export class MiddlewareManager {
    constructor();
    use(fn: MiddlewareFunction): MiddlewareManager;
    use(hook: MiddlewareHook, fn: MiddlewareFunction): MiddlewareManager;
    execute(hook: MiddlewareHook, context: MiddlewareContext): Promise<MiddlewareContext>;
    clear(hook?: MiddlewareHook): void;
    count(hook?: MiddlewareHook): number;
}

/**
 * Logging middleware options
 */
export interface LoggingMiddlewareOptions {
    logger?: (message: string) => void;
    logInput?: boolean;
    logResponse?: boolean;
    logTiming?: boolean;
}

/**
 * Rate limit middleware options
 */
export interface RateLimitMiddlewareOptions {
    maxRequests?: number;
    windowMs?: number;
    message?: string;
}

/**
 * Sanitization middleware options
 */
export interface SanitizationMiddlewareOptions {
    maxLength?: number;
    trim?: boolean;
    removeSpecialChars?: boolean;
}

/**
 * Metrics result
 */
export interface MetricsResult {
    totalRequests: number;
    totalErrors: number;
    errorRate: string;
    requestsByState: Record<string, number>;
    outcomes: Record<string, number>;
    averageResponseTime: string;
}

export interface TurnObservation {
    currentState: string;
    outcome: 'success' | 'validation_error' | 'error' | 'blocked' | 'replay' | 'flow_restart';
    durationMs: number;
}

/**
 * Create a logging middleware
 */
export function createLoggingMiddleware(options?: LoggingMiddlewareOptions): MiddlewareFunction;

/**
 * Rate limit middleware result
 *
 * IMPORTANT: This middleware uses in-memory storage for tracking requests.
 * It will NOT work correctly in distributed/clustered environments.
 * For distributed systems, use a Redis-based rate limiting solution.
 */
export interface RateLimitMiddlewareResult {
    /** The middleware function to use */
    middleware: MiddlewareFunction;
    /** Call this to stop the cleanup interval (for graceful shutdown) */
    cleanup: () => void;
    /** Reset all rate limit counters */
    reset: () => void;
}

/**
 * Create a rate limiting middleware
 *
 * IMPORTANT: This middleware uses in-memory storage for tracking requests.
 * It will NOT work correctly in distributed/clustered environments.
 * For distributed systems, use a Redis-based rate limiting solution.
 */
export function createRateLimitMiddleware(options?: RateLimitMiddlewareOptions): RateLimitMiddlewareResult;

/**
 * Create a session timeout middleware
 */
export function createSessionTimeoutMiddleware(options?: {
    warningThreshold?: number;
    warningMessage?: string;
}): MiddlewareFunction;

/**
 * Create an analytics middleware
 */
export function createAnalyticsMiddleware(options: {
    track: (event: string, properties: Record<string, any>) => void;
}): MiddlewareFunction;

/**
 * Create an input sanitization middleware
 */
export function createSanitizationMiddleware(options?: SanitizationMiddlewareOptions): MiddlewareFunction;

/**
 * Create a metrics collection middleware
 */
export function createMetricsMiddleware(options?: {}): {
    middleware: MiddlewareFunction;
    observeTurn: (turn: TurnObservation) => void;
    getMetrics: () => MetricsResult;
    resetMetrics: () => void;
};

// ==================== Validation Library ====================

/**
 * Validator function type
 */
export type ValidatorFunction = (input: string) => Promise<void>;

/**
 * Built-in validators
 */
export namespace Validators {
    export function required(message?: string | boolean): ValidatorFunction;
    export function minLength(options: number | { length: number; message?: string }): ValidatorFunction;
    export function maxLength(options: number | { length: number; message?: string }): ValidatorFunction;
    export function exactLength(options: number | { length: number; message?: string }): ValidatorFunction;
    export function pattern(options: RegExp | { pattern: RegExp; message?: string }): ValidatorFunction;
    export function numeric(options?: string | {
        message?: string;
        min?: number;
        max?: number;
        integer?: boolean;
        minMessage?: string;
        maxMessage?: string;
        integerMessage?: string;
    }): ValidatorFunction;
    export function phone(options?: {
        country?: 'KE' | 'NG' | 'ZA' | 'GH' | 'TZ' | 'UG' | 'international';
        message?: string;
    }): ValidatorFunction;
    export function email(options?: string | { message?: string }): ValidatorFunction;
    export function age(options?: {
        min?: number;
        max?: number;
        message?: string;
    }): ValidatorFunction;
    export function date(options?: {
        format?: 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'MM-DD-YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
        message?: string;
    }): ValidatorFunction;
    export function pin(options?: {
        length?: number;
        numericOnly?: boolean;
        message?: string;
    }): ValidatorFunction;
    export function amount(options?: {
        min?: number;
        max?: number;
        decimals?: number;
        message?: string;
    }): ValidatorFunction;
    export function oneOf(options: string[] | { values: string[]; message?: string }): ValidatorFunction;
    export function menuOption(options?: {
        max?: number;
        min?: number;
        allowed?: string[];
        message?: string;
    }): ValidatorFunction;
    export function idNumber(options?: {
        type?: 'generic' | 'kenyanId' | 'passport';
        message?: string;
    }): ValidatorFunction;
    export function custom(fn: (input: string) => Promise<void> | void): ValidatorFunction;
}

/**
 * Create a validator from rules object
 */
export function createValidator(rules: Record<string, any>): ValidatorFunction;

/**
 * Combine multiple validators into one
 */
export function combineValidators(...validators: ValidatorFunction[]): ValidatorFunction;

/**
 * Make a validator optional (only validate if input is not empty)
 */
export function optional(validator: ValidatorFunction): ValidatorFunction;

/**
 * Create a conditional validator
 */
export function when(
    condition: (input: string, context?: any) => boolean | Promise<boolean>,
    validator: ValidatorFunction
): ValidatorFunction;

// ==================== Debug Utilities ====================

/**
 * Debug logger function
 */
export interface DebugFunction {
    (...args: any[]): void;
    /** Whether this debug logger is enabled */
    enabled: boolean;
    /** The namespace of this debug logger */
    namespace: string;
}

/**
 * Pre-configured debug loggers for USSD State Machine components
 */
export interface Debuggers {
    /** State machine operations */
    state: DebugFunction;
    /** Middleware execution */
    middleware: DebugFunction;
    /** Storage operations */
    storage: DebugFunction;
    /** Session management */
    session: DebugFunction;
    /** Validation */
    validation: DebugFunction;
    /** I18n/translations */
    i18n: DebugFunction;
    /** Lifecycle events */
    lifecycle: DebugFunction;
    /** Performance metrics */
    performance: DebugFunction;
}

/**
 * Create a debug logger for a specific namespace
 * @param namespace - The namespace for this debug logger (e.g., 'ussd:state')
 * @returns Debug logging function
 */
export function createDebug(namespace: string): DebugFunction;

/**
 * Pre-configured debug loggers for USSD State Machine components
 */
export const debuggers: Debuggers;

/**
 * Check if any debug logging is enabled
 * @returns Whether any debug logging is enabled
 */
export function isDebugEnabled(): boolean;

/**
 * Get all enabled debug namespaces
 * @returns Array of enabled patterns
 */
export function getEnabledNamespaces(): string[];

// ==================== State Inspector ====================

/**
 * State machine summary
 */
export interface StateMachineSummary {
    metadataCoverage: 'complete' | 'partial';
    flowVersion: string | null;
    totalStates: number;
    initialState: string;
    backNavigationEnabled: boolean;
    sessionTimeout: number;
    states: string[];
    statesWithValidators: number;
    statesWithOnEnter: number;
    statesWithOnExit: number;
}

/**
 * State information
 */
export interface StateInfo {
    definition: FlowStateDefinition;
    name: string;
    isInitialState: boolean;
    hasHandler: boolean;
    hasValidator: boolean;
    hasOnEnter: boolean;
    hasOnExit: boolean;
    handlerType: string;
}

/**
 * Validation error or warning
 */
export interface ValidationIssue {
    type: string;
    message: string;
    state?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    stateCount: number;
}

/**
 * State machine introspection utility
 */
export class StateInspector {
    /**
     * Create a new StateInspector
     * @param stateMachine - USSDStateMachine instance or config object
     */
    constructor(stateMachine: USSDStateMachine | USSDConfig);

    /**
     * Get a summary of the state machine configuration
     * @returns Summary object with stats and state list
     */
    getSummary(): StateMachineSummary;

    /**
     * Get detailed information about a specific state
     * @param stateName - Name of the state to inspect
     * @returns State info or null if not found
     */
    getStateInfo(stateName: string): StateInfo | null;

    /**
     * Get all states that reference a given state (potential transitions to it)
     * @param stateName - Target state name
     * @returns Array of state names that might transition to the target
     */
    getPotentialTransitionsTo(stateName: string): string[];

    /**
     * Generate an ASCII diagram of the state machine
     * @returns ASCII representation of states
     */
    toAsciiDiagram(): string;

    toMermaid(): string;

    /**
     * Validate the state machine configuration
     * @returns Validation result with errors and warnings
     */
    validate(): ValidationResult;

    /**
     * Export state machine structure as JSON
     * @returns JSON-serializable structure
     */
    toJSON(): Record<string, any>;

    /**
     * Generate a DOT graph representation (for Graphviz)
     * @returns DOT language graph
     */
    toDotGraph(): string;
}

// ==================== I18n (Updated with caching) ====================

/**
 * I18n cache statistics
 */
export interface I18nCacheStats {
    hits: number;
    misses: number;
    evictions: number;
    size: number;
    maxSize: number;
    hitRate: string;
}

/**
 * I18n configuration options
 */
export interface I18nOptions {
    /** Default language code (default: 'en') */
    defaultLanguage?: string;
    /** Fallback language code (default: 'en') */
    fallbackLanguage?: string;
    /** Initial translations */
    translations?: Record<string, Record<string, string>>;
    /** Maximum cache size for translations (default: 1000) */
    cacheSize?: number;
}

/**
 * Translation options
 */
export interface TranslateOptions {
    /** Language code */
    language?: string;
    /** Interpolation parameters */
    params?: Record<string, any>;
    /** Count for pluralization */
    count?: number;
    /** Default value if not found */
    defaultValue?: string;
}

/**
 * Internationalization manager
 */
export class I18n {
    /** Default language code */
    defaultLanguage: string;
    /** Fallback language code */
    fallbackLanguage: string;
    /** All translations */
    translations: Record<string, Record<string, string>>;
    /** Custom formatters */
    formatters: Record<string, (value: any, options?: any) => string>;

    constructor(options?: I18nOptions);

    /**
     * Add translations for a language
     * @param language - Language code
     * @param translations - Translation key-value pairs
     * @returns this for chaining
     */
    addTranslations(language: string, translations: Record<string, any>): I18n;

    /**
     * Load translations from an object
     * @param allTranslations - Object with language codes as keys
     * @returns this for chaining
     */
    loadTranslations(allTranslations: Record<string, Record<string, any>>): I18n;

    /**
     * Get translation for a key
     * @param key - Translation key
     * @param options - Translation options
     * @returns Translated string
     */
    t(key: string, options?: TranslateOptions): string;

    /**
     * Alias for t()
     */
    translate(key: string, options?: TranslateOptions): string;

    /**
     * Check if a translation exists
     * @param key - Translation key
     * @param language - Language code
     * @returns Whether translation exists
     */
    hasTranslation(key: string, language?: string): boolean;

    /**
     * Get all available languages
     * @returns Array of language codes
     */
    getLanguages(): string[];

    /**
     * Set the default language
     * @param language - Language code
     * @returns this for chaining
     */
    setDefaultLanguage(language: string): I18n;

    /**
     * Get the current default language
     * @returns Default language code
     */
    getDefaultLanguage(): string;

    /**
     * Create a bound translator for a specific language
     * @param language - Language code
     * @returns Translator function
     */
    createTranslator(language: string): (key: string, options?: TranslateOptions) => string;

    /**
     * Create translations namespace
     * @param namespace - Namespace prefix
     * @returns Namespaced translator
     */
    ns(namespace: string): (key: string, options?: TranslateOptions) => string;

    /**
     * Add a custom formatter
     * @param name - Formatter name
     * @param formatter - Formatter function
     * @returns this for chaining
     */
    addFormatter(name: string, formatter: (value: any, options?: any) => string): I18n;

    /**
     * Export all translations
     * @returns All translations
     */
    exportTranslations(): Record<string, Record<string, string>>;

    /**
     * Clear all translations
     */
    clearTranslations(): void;

    /**
     * Get cache statistics
     * @returns Cache statistics
     */
    getCacheStats(): I18nCacheStats;
}

/**
 * Create a pre-configured i18n instance for USSD
 * @param options - I18n options
 * @returns Pre-configured I18n instance
 */
export function createUSSDI18n(options?: I18nOptions): I18n;

/**
 * Language detection utilities
 */
export namespace LanguageDetector {
    /**
     * Detect language from phone number prefix
     * @param phoneNumber - Phone number
     * @returns Language code or null
     */
    export function fromPhoneNumber(phoneNumber: string): string | null;

    /**
     * Detect language from USSD code
     * @param ussdCode - USSD code
     * @param codeMap - Map of codes to languages
     * @returns Language code or null
     */
    export function fromUSSDCode(ussdCode: string, codeMap?: Record<string, string>): string | null;
}

// ==================== SDK (Fluent Builder API) ====================

export {
    createApp,
    AppBuilder,
    StateBuilder,
    RouteBuilder,
    DynamicMenu,
    DynamicMenuBuilder,
    DynamicMenuOptions,
    DynamicMenuFetcher,
    PaginationOptions
} from './sdk';

export * from './advanced';
export * from './compat';

declare const _default: {
    USSDStateMachine: typeof USSDStateMachine;
    createApp: typeof import('./sdk').createApp;
};
export default _default;

export type UssdInputMode = 'cumulative' | 'incremental';
export interface NormalizedUssdInput {
    inputMode: UssdInputMode;
    input: string;
    transcript: string | null;
    position: number | null;
}
export function normalizeUssdInput(text: string, mode: UssdInputMode): NormalizedUssdInput;
export interface ProviderWireRequest {
    method: string;
    contentType?: string;
    /** Raw form bytes. Do not pass an already parsed framework body. */
    body: string | Buffer;
}
export interface ProviderSessionBinding {
    provider: 'africas-talking';
    applicationId: string;
    sessionId: string;
    serviceCode: string;
    phoneNumber: string;
    networkCode: string;
}
export interface AfricasTalkingTurn extends ProviderSessionBinding {
    sessionKey: string;
    inputMode: 'cumulative';
    input: string;
    transcript: string;
    position: number;
}
export interface ProviderHttpResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}
export interface AfricasTalkingAdapterOptions {
    applicationId: string;
    serviceCode: string;
    phonePattern?: RegExp;
    maxBodyBytes?: number;
    maxTranscriptLength?: number;
    maxFieldLength?: number;
    maxInputLength?: number;
    maxResponseBytes?: number;
}
export class ProviderRequestError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, status?: number);
}
export class AfricasTalkingAdapter {
    constructor(options: AfricasTalkingAdapterOptions);
    readonly applicationId: string;
    readonly serviceCode: string;
    readonly maxBodyBytes: number;
    normalize(request: ProviderWireRequest): AfricasTalkingTurn;
    bindSession(turn: AfricasTalkingTurn, existing?: ProviderSessionBinding | null): ProviderSessionBinding;
    compareTranscript(turn: AfricasTalkingTurn, previous?: string | null):
        'initial' | 'missing_initial' | 'repeat' | 'next' | 'stale' | 'gap' | 'conflict';
    formatResponse(response: string, options?: { hopMetadata?: string }): ProviderHttpResponse;
    errorResponse(error: unknown): ProviderHttpResponse;
    handle(request: ProviderWireRequest, processTurn: (turn: AfricasTalkingTurn) =>
        string | { response: string; hopMetadata?: string } |
        Promise<string | { response: string; hopMetadata?: string }>): Promise<ProviderHttpResponse>;
}

export interface TurnContext {
    /** Stable operation identity; use it with an external service's idempotency/journal API. */
    idempotencyKey: string;
    position: number;
    revision: number;
}
export interface TurnSessionSnapshot {
    state?: string | null;
    data?: Record<string, any> | null;
    stateHistory?: string[];
    expiresAt?: number | null;
}
export interface PreparedTurn {
    response: string;
    session: TurnSessionSnapshot | null;
    hopMetadata?: string;
    /** Invoke only after the complete snapshot and receipt commit. */
    notify?(): Promise<void>;
}
export interface PendingTurn extends TurnContext {
    /** Store-clock ownership deadline, when configured. */
    deadlineAt?: number;
    token: string;
    fingerprint: string;
    flowVersion: string | null;
    kind?: 'turn' | 'recovery';
}
export interface TurnReceipt {
    fingerprint: string;
    position: number;
    response: ProviderHttpResponse;
}
export interface TurnLedger {
    schemaVersion: 1;
    revision: number;
    binding: ProviderSessionBinding;
    transcript: string | null;
    completed: boolean;
    receipts: TurnReceipt[];
    pending: PendingTurn | null;
}
export interface TurnRecord extends TurnLedger {
    session: TurnSessionSnapshot | null;
    now: number;
    activeExpiresAt: number | null;
    receiptExpiresAt: number;
    closed?: boolean;
}
export interface AtomicTurnStore {
    readonly supportsDeadlines: true;
    storage: StorageAdapter;
    read(key: string, options?: { withClock?: boolean }): Promise<{ empty: true; now: number } | TurnRecord | { orphan: true; session: TurnSessionSnapshot; now: number } | null>;
    claim(key: string, revision: number, ledger: TurnLedger, receiptTTL: number, replaceToken?: string | null, leaseMs?: number, deadlineAt?: number): Promise<boolean>;
    commit(key: string, revision: number, token: string, ledger: TurnLedger, session: TurnSessionSnapshot | null,
        receiptTTL: number, activeMs: number): Promise<boolean>;
}
export class InMemoryTurnStore implements AtomicTurnStore {
    constructor(options: { storage: InMemoryStorage });
    storage: InMemoryStorage;
    readonly supportsDeadlines: true;
    read: AtomicTurnStore['read'];
    claim: AtomicTurnStore['claim'];
    commit: AtomicTurnStore['commit'];
}
export class RedisTurnStore implements AtomicTurnStore {
    constructor(options: { storage: RedisStorage });
    storage: RedisStorage;
    readonly supportsDeadlines: true;
    read: AtomicTurnStore['read'];
    claim: AtomicTurnStore['claim'];
    commit: AtomicTurnStore['commit'];
}
export interface TurnGatewayOptions {
    adapter: AfricasTalkingAdapter;
    machine: USSDStateMachine;
    store: AtomicTurnStore;
    deadlineMs?: number;
    leaseMs?: number;
    ownershipCheckMs?: number;
    receiptTTL?: number;
    maxTurns?: number;
    maxRecordBytes?: number;
    /** Pure initial-data mapper, with no business effects. */
    sessionData?: (turn: AfricasTalkingTurn, context: { signal: AbortSignal; deadlineAt: number }) => Record<string, any> | Promise<Record<string, any>>;
    /** Reconcile a durable operation journal; never blindly repeat the handler. */
    eventStore?: RedisSessionEventStore;
    recoverTurn?: (context: { turn: AfricasTalkingTurn; pending: PendingTurn; session: TurnSessionSnapshot | null; revision: number; signal: AbortSignal; deadlineAt: number }) =>
        PreparedTurn | null | Promise<PreparedTurn | null>;
}
export interface TurnRequestOptions { signal?: AbortSignal; deadlineAt?: number; }
export class TurnGateway {
    constructor(options: TurnGatewayOptions);
    handle(request: ProviderWireRequest, options?: TurnRequestOptions): Promise<ProviderHttpResponse>;
    process(turn: AfricasTalkingTurn, options?: TurnRequestOptions): Promise<ProviderHttpResponse>;
    /** Explicit application-authorized reconciliation; normal retries never call this automatically. */
    recover(request: ProviderWireRequest, options?: TurnRequestOptions): Promise<ProviderHttpResponse>;
}

export interface AfricasTalkingEndEvent {
    sessionKey: string;
    binding: ProviderSessionBinding;
    occurredAt: number;
    status: 'Incomplete' | 'Success' | 'Failed';
    fingerprint: string;
    fields: Readonly<Record<string, string>>;
}
export class AfricasTalkingEventAdapter {
    constructor(options: AfricasTalkingAdapterOptions);
    normalize(request: ProviderWireRequest): AfricasTalkingEndEvent;
}
export interface SessionEventRecord {
    schemaVersion: 1;
    revision: number;
    binding: ProviderSessionBinding;
    bindingSource: 'turn' | 'event_only';
    events: Array<{ fingerprint: string; occurredAt: number; status: AfricasTalkingEndEvent['status'] }>;
    outcome: AfricasTalkingEndEvent['status'] | 'conflict';
}
export class RedisSessionEventStore {
    constructor(options: { storage: RedisStorage; retentionSeconds?: number; maxEvents?: number });
    readonly storage: RedisStorage;
    read(sessionKey: string): Promise<SessionEventRecord | null>;
    accept(event: AfricasTalkingEndEvent): Promise<{ classification: 'accepted' | 'duplicate' | 'stale' | 'conflict'; record: SessionEventRecord }>;
}
export class SessionEventGateway {
    constructor(options: { adapter: AfricasTalkingEventAdapter; store: RedisSessionEventStore });
    handle(request: ProviderWireRequest): Promise<ProviderHttpResponse & { classification?: string }>;
}
