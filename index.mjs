/**
 * USSD State Builder - ESM Module
 *
 * ESM wrapper for the USSD State Machine library.
 * Enables tree-shaking with modern bundlers.
 *
 * @module ussd-state-builder
 */

import pkg from './index.js';

// Core
export const USSDStateMachine = pkg.USSDStateMachine;

// Errors
export const ValidationError = pkg.ValidationError;
export const USSDError = pkg.USSDError;
export const StateNotFoundError = pkg.StateNotFoundError;
export const SessionNotFoundError = pkg.SessionNotFoundError;
export const SessionExpiredError = pkg.SessionExpiredError;
export const StorageError = pkg.StorageError;
export const ConfigurationError = pkg.ConfigurationError;
export const HandlerError = pkg.HandlerError;
export const TimeoutError = pkg.TimeoutError;
export const RateLimitError = pkg.RateLimitError;
export const NavigationError = pkg.NavigationError;
export const ErrorHandler = pkg.ErrorHandler;

// Storage adapters
export const InMemoryStorage = pkg.InMemoryStorage;
export const RedisStorage = pkg.RedisStorage;
export const MongoDBStorage = pkg.MongoDBStorage;
export const PostgreSQLStorage = pkg.PostgreSQLStorage;
export const StorageInterface = pkg.StorageInterface;

// Session management
export const SessionManager = pkg.SessionManager;

// Response utilities
export const ResponseBuilder = pkg.ResponseBuilder;

// Middleware system
export const MiddlewareManager = pkg.MiddlewareManager;
export const createLoggingMiddleware = pkg.createLoggingMiddleware;
export const createRateLimitMiddleware = pkg.createRateLimitMiddleware;
export const createSessionTimeoutMiddleware = pkg.createSessionTimeoutMiddleware;
export const createAnalyticsMiddleware = pkg.createAnalyticsMiddleware;
export const createSanitizationMiddleware = pkg.createSanitizationMiddleware;
export const createMetricsMiddleware = pkg.createMetricsMiddleware;

// Validation library
export const Validators = pkg.Validators;
export const createValidator = pkg.createValidator;
export const combineValidators = pkg.combineValidators;
export const optional = pkg.optional;
export const when = pkg.when;

// Testing utilities
export const USSDTester = pkg.USSDTester;
export const runScenario = pkg.runScenario;
export const runScenarios = pkg.runScenarios;
export const MockStorage = pkg.MockStorage;

// Internationalization
export const I18n = pkg.I18n;
export const createUSSDI18n = pkg.createUSSDI18n;
export const LanguageDetector = pkg.LanguageDetector;

// Performance utilities
export const LRUCache = pkg.LRUCache;
export const memoize = pkg.memoize;
export const LazyLoader = pkg.LazyLoader;
export const debounce = pkg.debounce;
export const throttle = pkg.throttle;
export const BatchProcessor = pkg.BatchProcessor;
export const PerformanceMonitor = pkg.PerformanceMonitor;
export const createCachedStorage = pkg.createCachedStorage;

// Lifecycle management
export const HealthCheck = pkg.HealthCheck;
export const GracefulShutdown = pkg.GracefulShutdown;
export const HotReloader = pkg.HotReloader;

// Debug utilities
export const createDebug = pkg.createDebug;
export const debuggers = pkg.debuggers;
export const isDebugEnabled = pkg.isDebugEnabled;
export const getEnabledNamespaces = pkg.getEnabledNamespaces;

// State introspection
export const StateInspector = pkg.StateInspector;

// SDK (fluent builder API)
export const createApp = pkg.createApp;
export const AppBuilder = pkg.AppBuilder;
export const RouteBuilder = pkg.RouteBuilder;

// Default export
export default pkg;
