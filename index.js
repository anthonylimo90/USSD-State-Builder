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
const { DistributedLock, createDistributedLockManager } = require('./lib/DistributedLock');
const { SessionEncryption, createEncryptedStorage } = require('./lib/SessionEncryption');
const { PrometheusExporter, OpenTelemetryCollector, createExportableMetrics } = require('./lib/MetricsExporter');
const { SlidingWindowRateLimit, createSlidingWindowRateLimit } = require('./lib/SlidingWindowRateLimit');
const { FlowDiagram } = require('./lib/FlowDiagram');
const { analyzeFlowDefinition } = require('./lib/FlowAnalysis');
const { USSDSimulator } = require('./lib/USSDSimulator');
const { WebhookManager } = require('./lib/WebhookManager');
const { PluginManager, createPlugin } = require('./lib/PluginManager');
const { createApp, AppBuilder, StateBuilder, RouteBuilder, DynamicMenu, DynamicMenuBuilder } = require('./lib/sdk');
const { TRACE_SCHEMA_VERSION, MAX_TRACE_BYTES, MAX_FIXTURE_BYTES,
  createTraceEvent, createTraceObserver, createReplayFixture } = require('./lib/TraceSchema');
const { LocalWorkbench, WorkbenchError } = require('./lib/LocalWorkbench');
const { createWorkbenchServer } = require('./lib/WorkbenchServer');

const { AfricasTalkingAdapter, ProviderRequestError, normalizeUssdInput } = require('./lib/AfricasTalkingAdapter');

const { TurnGateway } = require('./lib/TurnGateway');
const { AfricasTalkingEventAdapter } = require('./lib/AfricasTalkingEventAdapter');
const { RedisSessionEventStore } = require('./lib/RedisSessionEventStore');
const { SessionEventGateway } = require('./lib/SessionEventGateway');
const { RedisTurnStore, InMemoryTurnStore } = require('./lib/TurnStore');

module.exports = {
  TurnGateway, RedisTurnStore, InMemoryTurnStore,
  AfricasTalkingEventAdapter, RedisSessionEventStore, SessionEventGateway,
  AfricasTalkingAdapter, ProviderRequestError, normalizeUssdInput,
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

  // Versioned, redacted turn traces and replay fixtures
  TRACE_SCHEMA_VERSION,
  MAX_TRACE_BYTES,
  MAX_FIXTURE_BYTES,
  createTraceEvent,
  createTraceObserver,
  createReplayFixture,
  LocalWorkbench,
  WorkbenchError,
  createWorkbenchServer,

  // State introspection
  StateInspector,

  // Resilience utilities
  CircuitBreaker,
  createProtectedStorage,
  RetryStrategy,
  createRetryStorage,

  // Distributed locking
  DistributedLock,
  createDistributedLockManager,

  // Session encryption
  SessionEncryption,
  createEncryptedStorage,

  // Metrics exporters
  PrometheusExporter,
  OpenTelemetryCollector,
  createExportableMetrics,

  // Sliding window rate limiting
  SlidingWindowRateLimit,
  createSlidingWindowRateLimit,

  // Flow diagram generator
  FlowDiagram,
  analyzeFlowDefinition,

  // USSD Simulator
  USSDSimulator,

  // Webhook support
  WebhookManager,

  // Plugin system
  PluginManager,
  createPlugin,

  // SDK (fluent builder API)
  createApp,
  AppBuilder,
  StateBuilder,
  RouteBuilder,
  DynamicMenu,
  DynamicMenuBuilder
};
