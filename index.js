/**
 * USSD State Builder
 * 
 * A flexible state machine for building USSD applications in Node.js.
 * 
 * @module ussd-state-builder
 */

const USSDStateMachine = require('./lib/USSDStateMachine');
const ValidationError = require('./lib/ValidationError');
const InMemoryStorage = require('./lib/InMemoryStorage');
const RedisStorage = require('./lib/RedisStorage');
const MongoDBStorage = require('./lib/MongoDBStorage');
const PostgreSQLStorage = require('./lib/PostgreSQLStorage');
const StorageInterface = require('./lib/StorageInterface');
const ResponseBuilder = require('./lib/ResponseBuilder');
const SessionManager = require('./lib/SessionManager');
const {
  MiddlewareManager,
  createLoggingMiddleware,
  createRateLimitMiddleware,
  createDistributedRateLimitMiddleware,
  createSessionTimeoutMiddleware,
  createAnalyticsMiddleware,
  createSanitizationMiddleware,
  createMetricsMiddleware
} = require('./lib/Middleware');
const {
  Validators,
  createValidator,
  combineValidators,
  optional,
  when
} = require('./lib/ValidationLibrary');
const {
  USSDTester,
  runScenario,
  runScenarios,
  MockStorage
} = require('./lib/TestingUtils');
const {
  I18n,
  createUSSDI18n,
  LanguageDetector
} = require('./lib/I18n');
const {
  USSDError,
  StateNotFoundError,
  SessionNotFoundError,
  SessionExpiredError,
  StorageError,
  ConfigurationError,
  HandlerError,
  TimeoutError,
  RateLimitError,
  NavigationError,
  ErrorHandler
} = require('./lib/Errors');
const {
  LRUCache,
  memoize,
  LazyLoader,
  debounce,
  throttle,
  BatchProcessor,
  PerformanceMonitor,
  createCachedStorage
} = require('./lib/Performance');
const {
  HealthCheck,
  GracefulShutdown,
  HotReloader
} = require('./lib/Lifecycle');
const {
  createDebug,
  debuggers,
  isDebugEnabled,
  getEnabledNamespaces
} = require('./lib/Debug');
const { StateInspector } = require('./lib/StateInspector');
const { CircuitBreaker, createProtectedStorage } = require('./lib/CircuitBreaker');
const { RetryStrategy, createRetryStorage } = require('./lib/RetryStrategy');
const { createApp, AppBuilder, StateBuilder, RouteBuilder, DynamicMenu, DynamicMenuBuilder } = require('./lib/sdk');

module.exports = {
  // Core
  USSDStateMachine,

  // Errors
  ValidationError,
  USSDError,
  StateNotFoundError,
  SessionNotFoundError,
  SessionExpiredError,
  StorageError,
  ConfigurationError,
  HandlerError,
  TimeoutError,
  RateLimitError,
  NavigationError,
  ErrorHandler,

  // Storage adapters
  InMemoryStorage,
  RedisStorage,
  MongoDBStorage,
  PostgreSQLStorage,
  StorageInterface,

  // Session management
  SessionManager,

  // Response utilities
  ResponseBuilder,

  // Middleware system
  MiddlewareManager,
  createLoggingMiddleware,
  createRateLimitMiddleware,
  createDistributedRateLimitMiddleware,
  createSessionTimeoutMiddleware,
  createAnalyticsMiddleware,
  createSanitizationMiddleware,
  createMetricsMiddleware,

  // Validation library
  Validators,
  createValidator,
  combineValidators,
  optional,
  when,

  // Testing utilities
  USSDTester,
  runScenario,
  runScenarios,
  MockStorage,

  // Internationalization
  I18n,
  createUSSDI18n,
  LanguageDetector,

  // Performance utilities
  LRUCache,
  memoize,
  LazyLoader,
  debounce,
  throttle,
  BatchProcessor,
  PerformanceMonitor,
  createCachedStorage,

  // Lifecycle management
  HealthCheck,
  GracefulShutdown,
  HotReloader,

  // Debug utilities
  createDebug,
  debuggers,
  isDebugEnabled,
  getEnabledNamespaces,

  // State introspection
  StateInspector,

  // Resilience utilities
  CircuitBreaker,
  createProtectedStorage,
  RetryStrategy,
  createRetryStorage,

  // SDK (fluent builder API)
  createApp,
  AppBuilder,
  StateBuilder,
  RouteBuilder,
  DynamicMenu,
  DynamicMenuBuilder
};