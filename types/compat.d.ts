import type { MiddlewareFunction, StateConfig, StorageAdapter, USSDStateMachine } from './index';

export class USSDError extends Error {
  constructor(message: string, code?: string, context?: Record<string, unknown>);
  code: string;
  context: Record<string, unknown>;
  timestamp: string;
  toJSON(): Record<string, unknown>;
}
export class StateNotFoundError extends USSDError { constructor(stateName: string, fromState?: string | null); }
export class SessionNotFoundError extends USSDError { constructor(sessionId: string); }
export class SessionExpiredError extends USSDError { constructor(sessionId: string, expiredAt?: Date | null); }
export class StorageError extends USSDError { constructor(message: string, operation: string, originalError?: Error | null); }
export class ConfigurationError extends USSDError { constructor(message: string, property?: string | null, value?: unknown); }
export class HandlerError extends USSDError { constructor(message: string, stateName?: string | null, originalError?: Error | null); }
export class TimeoutError extends USSDError { constructor(message: string, timeout?: number); }
export class RateLimitError extends USSDError { constructor(message: string, retryAfter?: number); }
export class NavigationError extends USSDError { constructor(message: string, direction: string, currentState?: string | null); }
export const ErrorHandler: {
  wrap<T extends (...args: any[]) => any>(fn: T, onError?: (error: Error, ...args: Parameters<T>) => unknown): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>> | unknown>;
  isUSSDError(error: Error): boolean;
  getUserMessage(error: Error, messages?: Record<string, string>): string;
  formatForLogging(error: Error): Record<string, unknown>;
};

export class SessionManager {
  constructor(storage: StorageAdapter, options?: { timeout?: number; trackMetadata?: boolean; trackAnalytics?: boolean });
  startSession(sessionId: string, metadata?: Record<string, unknown>): Promise<Record<string, unknown>>;
  getOrCreateSession(sessionId: string, metadata?: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<void>;
  recordInteraction(sessionId: string, input: string, state: string, response?: string | null): Promise<void>;
  recordError(sessionId: string, error: Error, state: string): Promise<void>;
  endSession(sessionId: string, completed?: boolean): Promise<void>;
  getSessionAnalytics(sessionId: string): Promise<Record<string, unknown>>;
  getGlobalAnalytics(): Record<string, unknown>;
  resetAnalytics(): void;
  getActiveSessionCount(): number;
  exportAnalytics(): Record<string, unknown>;
}

export function createDistributedRateLimitMiddleware(options: {
  redisClient: object; maxRequests?: number; windowMs?: number;
  keyPrefix?: string; message?: string;
}): { middleware: MiddlewareFunction; reset(sessionId?: string): Promise<void> };

export class USSDTester {
  constructor(stateMachine: USSDStateMachine, options?: { sessionId?: string });
  start(): this;
  input(input: string): this;
  inputs(...inputs: string[]): this;
  expectResponse(expected: string | RegExp, message?: string): this;
  expectResponseContains(substring: string, message?: string): this;
  expectState(state: string, message?: string): this;
  expectContinue(): this;
  expectEnd(): this;
  expectSessionData(expected: Record<string, unknown>): this;
  wait(ms: number): this;
  run(): Promise<unknown>;
  execute(): Promise<unknown>;
  getResult(): unknown;
  getHistory(): unknown[];
  reset(sessionId?: string): this;
}
export function runScenario(machine: USSDStateMachine, scenario: (tester: USSDTester) => unknown, options?: Record<string, unknown>): Promise<unknown>;
export function runScenarios(machine: USSDStateMachine, scenarios: Record<string, (tester: USSDTester) => unknown>, options?: Record<string, unknown>): Promise<unknown>;
export class MockStorage implements StorageAdapter {
  getState(id: string): Promise<string | null>;
  setState(id: string, state: string, timeout: number): Promise<void>;
  getData(id: string): Promise<Record<string, any> | null>;
  setData(id: string, data: Record<string, any>, timeout: number): Promise<void>;
  deleteSession(id: string): Promise<void>;
  clear(): void;
}

export class LRUCache<K = string, V = unknown> {
  constructor(options?: { maxSize?: number; ttl?: number });
  get(key: K): V | undefined;
  set(key: K, value: V, ttl?: number): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  getStats(): Record<string, number>;
  prune(): void;
}
export function memoize<T extends (...args: any[]) => any>(fn: T, options?: { maxSize?: number; ttl?: number; keyGenerator?: (...args: Parameters<T>) => string }): T & { clear(): void; cache: LRUCache };
export class LazyLoader {
  register(key: string, loader: () => Promise<unknown>): void;
  get(key: string): Promise<unknown>;
  isLoaded(key: string): boolean;
  preload(keys: string[]): Promise<void>;
  clear(key?: string): void;
}
export function debounce<T extends (...args: any[]) => any>(fn: T, wait: number): T;
export function throttle<T extends (...args: any[]) => any>(fn: T, wait: number): T;
export class BatchProcessor<T = unknown> {
  constructor(processor: (items: T[]) => Promise<void>, options?: Record<string, unknown>);
  add(item: T): void;
}
export class PerformanceMonitor {
  startTimer(name: string): void;
  endTimer(name: string): number;
  time<T>(name: string, fn: () => Promise<T>): Promise<T>;
  getMetrics(name: string): Record<string, unknown>;
  reset(): void;
}
export function createCachedStorage<T extends StorageAdapter>(storage: T, options?: Record<string, unknown>): T;

export class HealthCheck {
  constructor(options?: Record<string, unknown>);
  addCheck(name: string, check: () => Promise<unknown> | unknown): void;
  removeCheck(name: string): void;
  runStartupChecks(): Promise<unknown>;
  liveness(): Promise<unknown>;
  readiness(): Promise<unknown>;
  check(): Promise<unknown>;
  getStatus(): Promise<unknown>;
}
export class GracefulShutdown {
  constructor(options?: Record<string, unknown>);
  addHandler(handler: () => Promise<void> | void): void;
  requestStart(): void;
  requestEnd(): void;
  shutdown(): Promise<void>;
  registerSignalHandlers(): void;
  isShutdownInProgress(): boolean;
}
export class HotReloader {
  constructor(machine: USSDStateMachine, options?: Record<string, unknown>);
  updateState(name: string, config: StateConfig): void;
  addState(name: string, config: StateConfig): void;
  removeState(name: string): void;
  reloadAll(states: Record<string, StateConfig>, options?: Record<string, unknown>): void;
  setInitialState(name: string): void;
  getHistory(limit?: number): unknown[];
  clearHistory(): void;
  getStateCount(): number;
  getStateNames(): string[];
  validate(states: Record<string, StateConfig>): unknown;
}
export class CircuitBreaker {
  constructor(options?: Record<string, unknown>);
  execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T>;
  reset(): void;
  getStats(): Record<string, unknown>;
}
export function createProtectedStorage<T extends StorageAdapter>(storage: T, options?: Record<string, unknown>): T;
export class RetryStrategy {
  constructor(options?: Record<string, unknown>);
  calculateDelay(attempt: number): number;
  execute<T>(fn: () => Promise<T>): Promise<T>;
}
export function createRetryStorage<T extends StorageAdapter>(storage: T, options?: Record<string, unknown>): T;
