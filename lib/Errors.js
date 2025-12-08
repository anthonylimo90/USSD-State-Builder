/**
 * Custom Error Types for USSD State Machine
 * 
 * Provides specialized error classes for different error scenarios.
 */

/**
 * Base USSD Error class
 */
class USSDError extends Error {
    /**
     * Create a USSD Error
     * @param {string} message - Error message
     * @param {string} [code] - Error code
     * @param {Object} [context] - Additional context
     */
    constructor(message, code = 'USSD_ERROR', context = {}) {
        super(message);
        this.name = 'USSDError';
        this.code = code;
        this.context = context;
        this.timestamp = new Date().toISOString();

        // Capture stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /**
     * Convert to JSON
     * @returns {Object} JSON representation
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            context: this.context,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

/**
 * Validation Error
 * Thrown when input validation fails
 */
class ValidationError extends USSDError {
    /**
     * Create a Validation Error
     * @param {string} message - Error message
     * @param {string} [field] - Field that failed validation
     * @param {any} [value] - Value that failed validation
     */
    constructor(message, field = null, value = null) {
        super(message, 'VALIDATION_ERROR', { field, value });
        this.name = 'ValidationError';
        this.field = field;
        this.value = value;
    }
}

/**
 * State Not Found Error
 * Thrown when trying to transition to a non-existent state
 */
class StateNotFoundError extends USSDError {
    /**
     * Create a State Not Found Error
     * @param {string} stateName - Name of the missing state
     * @param {string} [fromState] - State trying to transition from
     */
    constructor(stateName, fromState = null) {
        super(`State "${stateName}" not found`, 'STATE_NOT_FOUND', { stateName, fromState });
        this.name = 'StateNotFoundError';
        this.stateName = stateName;
        this.fromState = fromState;
    }
}

/**
 * Session Not Found Error
 * Thrown when a session doesn't exist
 */
class SessionNotFoundError extends USSDError {
    /**
     * Create a Session Not Found Error
     * @param {string} sessionId - Session identifier
     */
    constructor(sessionId) {
        super(`Session "${sessionId}" not found`, 'SESSION_NOT_FOUND', { sessionId });
        this.name = 'SessionNotFoundError';
        this.sessionId = sessionId;
    }
}

/**
 * Session Expired Error
 * Thrown when a session has timed out
 */
class SessionExpiredError extends USSDError {
    /**
     * Create a Session Expired Error
     * @param {string} sessionId - Session identifier
     * @param {Date} [expiredAt] - When the session expired
     */
    constructor(sessionId, expiredAt = null) {
        super(`Session "${sessionId}" has expired`, 'SESSION_EXPIRED', { sessionId, expiredAt });
        this.name = 'SessionExpiredError';
        this.sessionId = sessionId;
        this.expiredAt = expiredAt;
    }
}

/**
 * Storage Error
 * Thrown when storage operations fail
 */
class StorageError extends USSDError {
    /**
     * Create a Storage Error
     * @param {string} message - Error message
     * @param {string} operation - Operation that failed (get, set, delete, etc.)
     * @param {Error} [originalError] - Original error
     */
    constructor(message, operation, originalError = null) {
        super(message, 'STORAGE_ERROR', { operation, originalError: originalError?.message });
        this.name = 'StorageError';
        this.operation = operation;
        this.originalError = originalError;
    }
}

/**
 * Configuration Error
 * Thrown when configuration is invalid
 */
class ConfigurationError extends USSDError {
    /**
     * Create a Configuration Error
     * @param {string} message - Error message
     * @param {string} [property] - Invalid property name
     * @param {any} [value] - Invalid value
     */
    constructor(message, property = null, value = null) {
        super(message, 'CONFIGURATION_ERROR', { property, value });
        this.name = 'ConfigurationError';
        this.property = property;
        this.invalidValue = value;
    }
}

/**
 * Handler Error
 * Thrown when a state handler fails
 */
class HandlerError extends USSDError {
    /**
     * Create a Handler Error
     * @param {string} message - Error message
     * @param {string} state - State where error occurred
     * @param {Error} [originalError] - Original error
     */
    constructor(message, state, originalError = null) {
        super(message, 'HANDLER_ERROR', { state, originalError: originalError?.message });
        this.name = 'HandlerError';
        this.state = state;
        this.originalError = originalError;
    }
}

/**
 * Timeout Error
 * Thrown when an operation times out
 */
class TimeoutError extends USSDError {
    /**
     * Create a Timeout Error
     * @param {string} message - Error message
     * @param {number} timeout - Timeout duration in ms
     * @param {string} [operation] - Operation that timed out
     */
    constructor(message, timeout, operation = 'unknown') {
        super(message, 'TIMEOUT_ERROR', { timeout, operation });
        this.name = 'TimeoutError';
        this.timeout = timeout;
        this.operation = operation;
    }
}

/**
 * Rate Limit Error
 * Thrown when rate limit is exceeded
 */
class RateLimitError extends USSDError {
    /**
     * Create a Rate Limit Error
     * @param {string} message - Error message
     * @param {number} limit - Rate limit
     * @param {number} [retryAfter] - Seconds until retry is allowed
     */
    constructor(message, limit, retryAfter = null) {
        super(message, 'RATE_LIMIT_ERROR', { limit, retryAfter });
        this.name = 'RateLimitError';
        this.limit = limit;
        this.retryAfter = retryAfter;
    }
}

/**
 * Navigation Error
 * Thrown when navigation fails (e.g., can't go back)
 */
class NavigationError extends USSDError {
    /**
     * Create a Navigation Error
     * @param {string} message - Error message
     * @param {string} direction - Navigation direction (back, forward, etc.)
     * @param {string} [currentState] - Current state
     */
    constructor(message, direction, currentState = null) {
        super(message, 'NAVIGATION_ERROR', { direction, currentState });
        this.name = 'NavigationError';
        this.direction = direction;
        this.currentState = currentState;
    }
}

/**
 * Error handler utility
 */
const ErrorHandler = {
    /**
     * Wrap an async function with error handling
     * @param {Function} fn - Async function to wrap
     * @param {Function} [onError] - Error handler
     * @returns {Function} Wrapped function
     */
    wrap(fn, onError) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                if (onError) {
                    return onError(error, ...args);
                }
                throw error;
            }
        };
    },

    /**
     * Check if error is a USSD error
     * @param {Error} error - Error to check
     * @returns {boolean} Whether error is a USSD error
     */
    isUSSDError(error) {
        return error instanceof USSDError;
    },

    /**
     * Get user-friendly message for an error
     * @param {Error} error - Error
     * @param {Object} [messages] - Custom messages by error code
     * @returns {string} User-friendly message
     */
    getUserMessage(error, messages = {}) {
        if (error instanceof ValidationError) {
            return error.message;
        }

        if (error instanceof SessionExpiredError) {
            return messages.SESSION_EXPIRED || 'Your session has expired. Please try again.';
        }

        if (error instanceof RateLimitError) {
            return messages.RATE_LIMIT || 'Too many requests. Please try again later.';
        }

        if (error instanceof USSDError && messages[error.code]) {
            return messages[error.code];
        }

        return messages.DEFAULT || 'An error occurred. Please try again.';
    },

    /**
     * Format error for logging
     * @param {Error} error - Error to format
     * @returns {Object} Formatted error
     */
    formatForLogging(error) {
        if (error instanceof USSDError) {
            return error.toJSON();
        }

        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        };
    }
};

module.exports = {
    USSDError,
    ValidationError,
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
};
