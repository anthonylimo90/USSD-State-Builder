import { StorageAdapter, USSDConfig, USSDStateMachine, MiddlewareFunction } from './index';

export interface DistributedLockOptions {
    redisClient: {
        set(key: string, value: string, options: object): Promise<unknown>;
        eval(script: string, options: object): Promise<unknown>;
    };
    keyPrefix?: string;
    lockTTL?: number;
    acquireTimeout?: number;
    retryInterval?: number;
    retryJitter?: number;
    onLockFailure?: (sessionId: string, timeout: number) => void;
}

export class DistributedLock {
    constructor(options: DistributedLockOptions);
    acquire(sessionId: string): Promise<() => Promise<void>>;
    extend(sessionId: string, additionalMs?: number): Promise<boolean>;
    isLocked(sessionId: string): Promise<boolean>;
    forceRelease(sessionId: string): Promise<boolean>;
    releaseAll(): Promise<number>;
    getStats(): Record<string, number>;
}

export function createDistributedLockManager<T extends StorageAdapter>(
    storage: T,
    options: DistributedLockOptions
): T & { withSessionLock<R>(sessionId: string, fn: () => Promise<R>): Promise<R>; _distributedLock: DistributedLock };

export interface SessionEncryptionOptions {
    encryptionKey: string | Buffer;
    encryptFields?: string[];
    encryptState?: boolean;
    keyDerivation?: (key: string) => Buffer;
}

export class SessionEncryption {
    constructor(options: SessionEncryptionOptions);
    encrypt(value: unknown): string | null | undefined;
    decrypt(value: string | null | undefined): string | null | undefined;
    encryptData(data: Record<string, any>): Record<string, any>;
    decryptData(data: Record<string, any>): Record<string, any>;
}

export function createEncryptedStorage<T extends StorageAdapter>(storage: T, options: SessionEncryptionOptions): T & { _encryption: SessionEncryption };

export class PrometheusExporter {
    constructor(options?: Record<string, any>);
    observe(durationMs: number, labels?: Record<string, string>): void;
    export(metrics: Record<string, any>): string;
    reset(): void;
}

export class OpenTelemetryCollector {
    constructor(options?: Record<string, any>);
    recordSpan(spanData: Record<string, any>): void;
    export(metrics: Record<string, any>): Record<string, any>;
    getSpans(limit?: number): Record<string, any>[];
    clearSpans(): void;
}

export function createExportableMetrics(options?: Record<string, any>): {
    middleware: MiddlewareFunction;
    getMetrics(): Record<string, any>;
    resetMetrics(): void;
    exportMetrics(): string | Record<string, any>;
    prometheus: PrometheusExporter;
    opentelemetry: OpenTelemetryCollector;
};

export interface SlidingWindowOptions {
    maxRequests?: number;
    windowMs?: number;
    precision?: number;
    message?: string;
}

export class SlidingWindowRateLimit {
    constructor(options?: SlidingWindowOptions);
    check(key: string): { allowed: boolean; remaining: number; limit: number; resetAt: number; retryAfter: number };
    reset(key: string): void;
    resetAll(): void;
    destroy(): void;
    getStats(): Record<string, number>;
}

export function createSlidingWindowRateLimit(options?: SlidingWindowOptions): {
    middleware: MiddlewareFunction;
    limiter: SlidingWindowRateLimit;
    cleanup(): void;
    reset(key?: string): void;
    getStats(): Record<string, number>;
};

export class FlowDiagram {
    constructor(stateMachine: USSDStateMachine | USSDConfig, options?: Record<string, any>);
    toMermaid(): string;
    toDot(): string;
    toAscii(): string;
    toJSON(): Record<string, any>;
}

export class USSDSimulator {
    constructor(stateMachine: USSDStateMachine, options?: Record<string, any>);
    send(input: string): Promise<Record<string, any>>;
    runScenario(inputs: string[]): Promise<Record<string, any>[]>;
    startInteractive(): Promise<void>;
    reset(): Promise<void>;
    getHistory(): Record<string, any>[];
    getSummary(): Record<string, any>;
}

export class WebhookManager {
    constructor(options?: Record<string, any>);
    register(sessionId: string, options?: Record<string, any>): Promise<{ webhookId: string; secret: string; expiresAt: number; callbackUrl: string }>;
    receive(webhookId: string, payload: Record<string, any>, secret: string): Promise<Record<string, any>>;
    getStatus(webhookId: string): Promise<Record<string, any> | null>;
    cancel(webhookId: string): Promise<boolean>;
    getPendingForSession(sessionId: string): Promise<Record<string, any>[]>;
    destroy(): void;
    getStats(): Record<string, number>;
}

export class PluginManager {
    constructor(options?: Record<string, any>);
    register(plugin: Record<string, any>, options?: Record<string, any>): PluginManager;
    unregister(name: string): boolean;
    getStates(): Record<string, any>;
    getPluginEntryState(pluginName: string): string | null;
    getHooks(): Record<string, any>;
    getMiddlewares(): any[];
    applyTo<T>(target: T): T | Record<string, any>;
    list(): Record<string, any>[];
    has(name: string): boolean;
    readonly size: number;
}

export function createPlugin(config: Record<string, any>): Record<string, any>;
