/**
 * Debug Logging Utility for USSD State Machine
 *
 * Lightweight debug utility that respects the DEBUG environment variable.
 * Zero dependencies, inspired by the debug npm package.
 *
 * Usage:
 *   DEBUG=ussd:* node app.js           # Enable all ussd debug logs
 *   DEBUG=ussd:state node app.js       # Enable only state machine logs
 *   DEBUG=ussd:state,ussd:middleware   # Enable specific namespaces
 *   DEBUG=* node app.js                # Enable all debug logs
 */

const DEBUG_ENV = process.env.DEBUG || '';

// Parse debug patterns from environment variable
const patterns = DEBUG_ENV.split(',')
    .map(p => p.trim())
    .filter(Boolean);

/**
 * Check if a namespace matches any enabled pattern
 * @param {string} namespace - The namespace to check
 * @param {string[]} enabledPatterns - Array of enabled patterns
 * @returns {boolean} Whether the namespace is enabled
 */
function matchesPattern(namespace, enabledPatterns) {
    return enabledPatterns.some(pattern => {
        // Exact match
        if (pattern === namespace) return true;

        // Wildcard: enable all
        if (pattern === '*') return true;

        // Prefix wildcard: ussd:* matches ussd:state, ussd:middleware, etc.
        if (pattern.endsWith(':*')) {
            const prefix = pattern.slice(0, -1); // Remove the '*'
            return namespace.startsWith(prefix);
        }

        // Suffix wildcard: *:state matches ussd:state, app:state, etc.
        if (pattern.startsWith('*:')) {
            const suffix = pattern.slice(1); // Remove the '*'
            return namespace.endsWith(suffix);
        }

        return false;
    });
}

/**
 * Create a debug logger for a specific namespace
 * @param {string} namespace - The namespace for this debug logger (e.g., 'ussd:state')
 * @returns {Function} Debug logging function
 */
function createDebug(namespace) {
    const enabled = matchesPattern(namespace, patterns);

    /**
     * Debug log function
     * @param {...any} args - Arguments to log
     */
    const debug = (...args) => {
        if (!enabled) return;

        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] ${namespace}:`;

        // Format objects nicely
        const formattedArgs = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch {
                    return String(arg);
                }
            }
            return arg;
        });

        console.log(prefix, ...formattedArgs);
    };

    // Attach enabled flag for checking
    debug.enabled = enabled;

    // Attach namespace for reference
    debug.namespace = namespace;

    return debug;
}

/**
 * Pre-configured debug loggers for USSD State Machine components
 */
const debuggers = {
    /** State machine operations */
    state: createDebug('ussd:state'),
    /** Middleware execution */
    middleware: createDebug('ussd:middleware'),
    /** Storage operations */
    storage: createDebug('ussd:storage'),
    /** Session management */
    session: createDebug('ussd:session'),
    /** Validation */
    validation: createDebug('ussd:validation'),
    /** I18n/translations */
    i18n: createDebug('ussd:i18n'),
    /** Lifecycle events */
    lifecycle: createDebug('ussd:lifecycle'),
    /** Performance metrics */
    performance: createDebug('ussd:performance')
};

/**
 * Check if any debug logging is enabled
 * @returns {boolean} Whether any debug logging is enabled
 */
function isDebugEnabled() {
    return patterns.length > 0;
}

/**
 * Get all enabled debug namespaces
 * @returns {string[]} Array of enabled patterns
 */
function getEnabledNamespaces() {
    return [...patterns];
}

module.exports = {
    createDebug,
    debuggers,
    isDebugEnabled,
    getEnabledNamespaces
};
