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
 *
 * Log Levels (DEBUG_LEVEL env var):
 *   DEBUG_LEVEL=debug   # Show all logs (default)
 *   DEBUG_LEVEL=info    # Show info, warn, error
 *   DEBUG_LEVEL=warn    # Show warn, error only
 *   DEBUG_LEVEL=error   # Show error only
 */

const DEBUG_ENV = process.env.DEBUG || '';

const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

// Parse debug patterns from environment variable
const patterns = DEBUG_ENV.split(',')
    .map(p => p.trim())
    .filter(Boolean);

/**
 * Resolve the current log level threshold from the DEBUG_LEVEL env var.
 * Read at call time so it can be changed at runtime.
 * @returns {number} The numeric log level threshold
 */
function getLogLevelThreshold() {
    const envLevel = (process.env.DEBUG_LEVEL || 'debug').toLowerCase();
    const threshold = LOG_LEVELS[envLevel];
    if (threshold === undefined) {
        return LOG_LEVELS.debug;
    }
    return threshold;
}

/**
 * Check if a given log level meets the current threshold
 * @param {string} level - The log level to check
 * @returns {boolean} Whether the level is at or above the threshold
 */
function meetsLevelThreshold(level) {
    const threshold = getLogLevelThreshold();
    const levelValue = LOG_LEVELS[level];
    if (levelValue === undefined) {
        return true;
    }
    return levelValue >= threshold;
}

/**
 * Check if a namespace matches any enabled pattern.
 * Supports exact matches, full wildcards (*), prefix wildcards (ussd:*),
 * suffix wildcards (*:state), and glob-style wildcards (us*:st*).
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

        // General glob wildcard: convert pattern with * to regex
        if (pattern.includes('*')) {
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
            return new RegExp(regexStr).test(namespace);
        }

        return false;
    });
}

/**
 * Format arguments for log output, converting objects to readable JSON
 * @param {any[]} args - Arguments to format
 * @returns {any[]} Formatted arguments
 */
function formatArgs(args) {
    return args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
            try {
                return JSON.stringify(arg, null, 2);
            } catch {
                return String(arg);
            }
        }
        return arg;
    });
}

/**
 * Create a debug logger for a specific namespace
 * @param {string} namespace - The namespace for this debug logger (e.g., 'ussd:state')
 * @returns {Function} Debug logging function with additional methods
 */
function createDebug(namespace) {
    const enabled = matchesPattern(namespace, patterns);

    // Active timers for this debug instance
    const timers = new Map();

    /**
     * Debug log function (default level: debug)
     * @param {...any} args - Arguments to log
     */
    const debug = (...args) => {
        if (!enabled) return;
        if (!meetsLevelThreshold('debug')) return;

        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] ${namespace}:`;
        const formattedArgs = formatArgs(args);

        console.log(prefix, ...formattedArgs);
    };

    // Attach enabled flag for checking
    debug.enabled = enabled;

    // Attach namespace for reference
    debug.namespace = namespace;

    /**
     * Log at info level
     * @param {...any} args - Arguments to log
     */
    debug.info = (...args) => {
        if (!enabled) return;
        if (!meetsLevelThreshold('info')) return;

        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] INFO ${namespace}:`;
        const formattedArgs = formatArgs(args);

        console.log(prefix, ...formattedArgs);
    };

    /**
     * Log at debug level (same as calling debug directly)
     * @param {...any} args - Arguments to log
     */
    debug.debug = (...args) => {
        debug(...args);
    };

    /**
     * Log at warn level
     * @param {...any} args - Arguments to log
     */
    debug.warn = (...args) => {
        if (!enabled) return;
        if (!meetsLevelThreshold('warn')) return;

        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] WARN ${namespace}:`;
        const formattedArgs = formatArgs(args);

        console.warn(prefix, ...formattedArgs);
    };

    /**
     * Log at error level
     * @param {...any} args - Arguments to log
     */
    debug.error = (...args) => {
        if (!enabled) return;
        if (!meetsLevelThreshold('error')) return;

        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] ERROR ${namespace}:`;
        const formattedArgs = formatArgs(args);

        console.error(prefix, ...formattedArgs);
    };

    /**
     * Output structured JSON log entry
     * @param {string} message - Log message or event name
     * @param {object} [data={}] - Structured data to include in the log
     */
    debug.json = (message, data = {}) => {
        if (!enabled) return;
        if (!meetsLevelThreshold('debug')) return;

        const entry = {
            timestamp: new Date().toISOString(),
            namespace,
            message,
            ...data
        };

        console.log(JSON.stringify(entry));
    };

    /**
     * Start a performance timer
     * @param {string} label - Timer label
     */
    debug.time = (label) => {
        if (!enabled) return;
        timers.set(label, process.hrtime.bigint());
    };

    /**
     * End a performance timer and log the elapsed duration
     * @param {string} label - Timer label (must match a previous debug.time call)
     * @returns {number|undefined} Elapsed time in milliseconds, or undefined if timer not found
     */
    debug.timeEnd = (label) => {
        if (!enabled) return undefined;

        const startTime = timers.get(label);
        if (startTime === undefined) {
            debug.warn(`Timer "${label}" does not exist`);
            return undefined;
        }

        timers.delete(label);

        const elapsed = process.hrtime.bigint() - startTime;
        const elapsedMs = Number(elapsed) / 1_000_000;

        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] ${namespace}:`;
        console.log(prefix, `${label}: ${elapsedMs.toFixed(3)}ms`);

        return elapsedMs;
    };

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
