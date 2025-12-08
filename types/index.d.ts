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
    /** Current session data */
    sessionData?: Record<string, any>;
    /** Previous state (if available) */
    previousState?: string;
    /** Language preference */
    language?: string;
}

/**
 * Configuration for a single state
 */
export interface StateConfig {
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
    cleanup?(): void | Promise<void>;
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
 * Configuration for the USSD State Machine
 */
export interface USSDConfig {
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
}

/**
 * Options for processing input
 */
export interface ProcessInputOptions {
    /** Language preference for the session */
    language?: string;
}

/**
 * Main USSD State Machine class
 */
export class USSDStateMachine {
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
 * In-memory storage implementation
 */
export class InMemoryStorage implements StorageAdapter {
    constructor();
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
    averageResponseTime: string;
}

/**
 * Create a logging middleware
 */
export function createLoggingMiddleware(options?: LoggingMiddlewareOptions): MiddlewareFunction;

/**
 * Create a rate limiting middleware
 */
export function createRateLimitMiddleware(options?: RateLimitMiddlewareOptions): MiddlewareFunction;

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
