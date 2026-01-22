/**
 * Validation Library for USSD State Machine
 *
 * Provides common validators and utility functions for input validation.
 * All validators return a Promise that resolves if valid, or rejects with ValidationError.
 *
 * SECURITY NOTICE:
 * ================
 * State validators are OPTIONAL by design, but this means you MUST explicitly add
 * validation to every state that accepts user input. Unvalidated input can lead to:
 *
 * - Injection attacks (if input is used in database queries or shell commands)
 * - Logic errors (if input doesn't match expected format)
 * - Data corruption (if malformed data is stored)
 *
 * BEST PRACTICES:
 * 1. Always validate user input at system boundaries (USSD input is a boundary)
 * 2. Use the built-in validators for common patterns (phone, email, amount, etc.)
 * 3. Combine validators with combineValidators() for complex validation
 * 4. Never trust user input - validate before using in queries, commands, or storage
 *
 * @example
 * // RECOMMENDED: Always add validators to states accepting user input
 * const states = {
 *   ENTER_PHONE: {
 *     handler: async (input) => { ... },
 *     validator: Validators.phone({ country: 'KE' }) // Validates phone format
 *   },
 *   ENTER_AMOUNT: {
 *     handler: async (input) => { ... },
 *     validator: combineValidators(
 *       Validators.required('Amount is required'),
 *       Validators.amount({ min: 10, max: 100000 })
 *     )
 *   }
 * };
 */

const ValidationError = require('./ValidationError');

/**
 * Create a validator function from rules
 * @param {Object} rules - Validation rules
 * @returns {Function} Validator function
 */
function createValidator(rules) {
    return async (input) => {
        for (const [ruleName, ruleValue] of Object.entries(rules)) {
            const validator = Validators[ruleName];
            if (validator) {
                await validator(ruleValue)(input);
            }
        }
    };
}

/**
 * Built-in validators
 */
const Validators = {
    /**
     * Validate input is not empty
     * @param {string|boolean} message - Error message or true for default
     * @returns {Function} Validator function
     */
    required: (message = 'This field is required') => async (input) => {
        if (!input || input.trim() === '') {
            throw new ValidationError(typeof message === 'string' ? message : 'This field is required');
        }
    },

    /**
     * Validate minimum length
     * @param {number|Object} options - Min length or {length, message}
     * @returns {Function} Validator function
     */
    minLength: (options) => async (input) => {
        const length = typeof options === 'number' ? options : options.length;
        const message = typeof options === 'object' ? options.message : `Minimum ${length} characters required`;

        if (input && input.length < length) {
            throw new ValidationError(message);
        }
    },

    /**
     * Validate maximum length
     * @param {number|Object} options - Max length or {length, message}
     * @returns {Function} Validator function
     */
    maxLength: (options) => async (input) => {
        const length = typeof options === 'number' ? options : options.length;
        const message = typeof options === 'object' ? options.message : `Maximum ${length} characters allowed`;

        if (input && input.length > length) {
            throw new ValidationError(message);
        }
    },

    /**
     * Validate exact length
     * @param {number|Object} options - Exact length or {length, message}
     * @returns {Function} Validator function
     */
    exactLength: (options) => async (input) => {
        const length = typeof options === 'number' ? options : options.length;
        const message = typeof options === 'object' ? options.message : `Must be exactly ${length} characters`;

        if (input && input.length !== length) {
            throw new ValidationError(message);
        }
    },

    /**
     * Validate input matches regex pattern
     * @param {RegExp|Object} options - Pattern or {pattern, message}
     * @returns {Function} Validator function
     */
    pattern: (options) => async (input) => {
        const pattern = options instanceof RegExp ? options : options.pattern;
        const message = typeof options === 'object' && options.message ? options.message : 'Invalid format';

        if (input && !pattern.test(input)) {
            throw new ValidationError(message);
        }
    },

    /**
     * Validate input is a valid number
     * @param {string|Object} options - Error message or {message, min, max, integer}
     * @returns {Function} Validator function
     */
    numeric: (options = {}) => async (input) => {
        const message = typeof options === 'string' ? options : (options.message || 'Must be a valid number');

        if (input === '' || input === null || input === undefined) return;

        const num = Number(input);
        if (isNaN(num)) {
            throw new ValidationError(message);
        }

        if (typeof options === 'object') {
            if (options.integer && !Number.isInteger(num)) {
                throw new ValidationError(options.integerMessage || 'Must be a whole number');
            }
            if (options.min !== undefined && num < options.min) {
                throw new ValidationError(options.minMessage || `Must be at least ${options.min}`);
            }
            if (options.max !== undefined && num > options.max) {
                throw new ValidationError(options.maxMessage || `Must be at most ${options.max}`);
            }
        }
    },

    /**
     * Validate input is a valid phone number
     * @param {Object} [options] - Validation options
     * @param {string} [options.country] - Country code for format validation
     * @param {string} [options.message] - Custom error message
     * @returns {Function} Validator function
     */
    phone: (options = {}) => async (input) => {
        const message = options.message || 'Invalid phone number';

        if (!input || input.trim() === '') return;

        // Remove common formatting
        const cleaned = input.replace(/[\s\-\(\)\.]/g, '');

        // Basic phone validation patterns by region
        const patterns = {
            KE: /^(?:\+?254|0)?[17]\d{8}$/, // Kenya
            NG: /^(?:\+?234|0)?[789]\d{9}$/, // Nigeria
            ZA: /^(?:\+?27|0)?[678]\d{8}$/, // South Africa
            GH: /^(?:\+?233|0)?[235]\d{8}$/, // Ghana
            TZ: /^(?:\+?255|0)?[67]\d{8}$/, // Tanzania
            UG: /^(?:\+?256|0)?[7]\d{8}$/, // Uganda
            international: /^\+?[1-9]\d{6,14}$/ // International format
        };

        const pattern = options.country && patterns[options.country]
            ? patterns[options.country]
            : patterns.international;

        if (!pattern.test(cleaned)) {
            throw new ValidationError(message);
        }
    },

    /**
     * Validate input is a valid email address
     * @param {string|Object} options - Error message or options object
     * @returns {Function} Validator function
     */
    email: (options = {}) => async (input) => {
        const message = typeof options === 'string' ? options : (options.message || 'Invalid email address');

        if (!input || input.trim() === '') return;

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(input)) {
            throw new ValidationError(message);
        }
    },

    /**
     * Validate input is a valid age
     * @param {Object} options - Age validation options
     * @param {number} [options.min=0] - Minimum age
     * @param {number} [options.max=150] - Maximum age
     * @param {string} [options.message] - Custom error message
     * @returns {Function} Validator function
     */
    age: (options = {}) => async (input) => {
        const { min = 0, max = 150, message } = options;

        if (!input || input.trim() === '') return;

        const age = parseInt(input, 10);
        if (isNaN(age)) {
            throw new ValidationError(message || 'Invalid age');
        }
        if (age < min) {
            throw new ValidationError(message || `Must be at least ${min} years old`);
        }
        if (age > max) {
            throw new ValidationError(message || `Must be at most ${max} years old`);
        }
    },

    /**
     * Validate input is a valid date
     * @param {Object} [options] - Date validation options
     * @param {string} [options.format='YYYY-MM-DD'] - Expected format
     * @param {string} [options.message] - Custom error message
     * @returns {Function} Validator function
     */
    date: (options = {}) => async (input) => {
        const { format = 'YYYY-MM-DD', message = 'Invalid date format' } = options;

        if (!input || input.trim() === '') return;

        // Simple date patterns
        const patterns = {
            'YYYY-MM-DD': /^\d{4}-\d{2}-\d{2}$/,
            'DD-MM-YYYY': /^\d{2}-\d{2}-\d{4}$/,
            'MM-DD-YYYY': /^\d{2}-\d{2}-\d{4}$/,
            'DD/MM/YYYY': /^\d{2}\/\d{2}\/\d{4}$/,
            'MM/DD/YYYY': /^\d{2}\/\d{2}\/\d{4}$/
        };

        const pattern = patterns[format];
        if (pattern && !pattern.test(input)) {
            throw new ValidationError(message);
        }

        // Validate it's a real date
        const date = new Date(input);
        if (isNaN(date.getTime())) {
            throw new ValidationError(message);
        }
    },

    /**
     * Validate input is a valid PIN/password
     * @param {Object} [options] - PIN validation options
     * @param {number} [options.length=4] - Expected PIN length
     * @param {boolean} [options.numericOnly=true] - Only allow numbers
     * @param {string} [options.message] - Custom error message
     * @returns {Function} Validator function
     */
    pin: (options = {}) => async (input) => {
        const { length = 4, numericOnly = true, message } = options;

        if (!input || input.trim() === '') return;

        if (numericOnly && !/^\d+$/.test(input)) {
            throw new ValidationError(message || 'PIN must contain only numbers');
        }

        if (input.length !== length) {
            throw new ValidationError(message || `PIN must be ${length} digits`);
        }
    },

    /**
     * Validate input is a valid amount/currency
     * @param {Object} [options] - Amount validation options
     * @param {number} [options.min] - Minimum amount
     * @param {number} [options.max] - Maximum amount
     * @param {number} [options.decimals=2] - Allowed decimal places
     * @param {string} [options.message] - Custom error message
     * @returns {Function} Validator function
     */
    amount: (options = {}) => async (input) => {
        const { min, max, decimals = 2, message = 'Invalid amount' } = options;

        if (!input || input.trim() === '') return;

        // Remove currency symbols and commas
        const cleaned = input.replace(/[,$£€¥₦₹]/g, '').trim();
        const amount = parseFloat(cleaned);

        if (isNaN(amount)) {
            throw new ValidationError(message);
        }

        if (amount < 0) {
            throw new ValidationError('Amount cannot be negative');
        }

        if (min !== undefined && amount < min) {
            throw new ValidationError(`Minimum amount is ${min}`);
        }

        if (max !== undefined && amount > max) {
            throw new ValidationError(`Maximum amount is ${max}`);
        }

        // Check decimal places
        const parts = cleaned.split('.');
        if (parts[1] && parts[1].length > decimals) {
            throw new ValidationError(`Maximum ${decimals} decimal places allowed`);
        }
    },

    /**
     * Validate input is one of allowed values
     * @param {Array|Object} options - Allowed values array or {values, message}
     * @returns {Function} Validator function
     */
    oneOf: (options) => async (input) => {
        const values = Array.isArray(options) ? options : options.values;
        const message = typeof options === 'object' && options.message
            ? options.message
            : `Must be one of: ${values.join(', ')}`;

        if (!input || input.trim() === '') return;

        if (!values.includes(input)) {
            throw new ValidationError(message);
        }
    },

    /**
     * Validate input matches menu option (1-9, or custom range)
     * @param {Object} [options] - Menu validation options
     * @param {number} [options.max=9] - Maximum option number
     * @param {number} [options.min=1] - Minimum option number
     * @param {Array} [options.allowed] - Specific allowed options
     * @param {string} [options.message] - Custom error message
     * @returns {Function} Validator function
     */
    menuOption: (options = {}) => async (input) => {
        const { max = 9, min = 1, allowed, message = 'Invalid option' } = options;

        if (!input || input.trim() === '') return;

        if (allowed) {
            if (!allowed.includes(input)) {
                throw new ValidationError(message);
            }
            return;
        }

        const num = parseInt(input, 10);
        if (isNaN(num) || num < min || num > max) {
            throw new ValidationError(message);
        }
    },

    /**
     * Validate ID number (national ID, passport, etc.)
     * @param {Object} [options] - ID validation options
     * @param {string} [options.type='generic'] - Type: 'generic', 'kenyanId', 'passport'
     * @param {string} [options.message] - Custom error message
     * @returns {Function} Validator function
     */
    idNumber: (options = {}) => async (input) => {
        const { type = 'generic', message = 'Invalid ID number' } = options;

        if (!input || input.trim() === '') return;

        const patterns = {
            generic: /^[A-Z0-9]{5,20}$/i,
            kenyanId: /^\d{7,8}$/,
            passport: /^[A-Z]{1,2}\d{6,9}$/i
        };

        const pattern = patterns[type] || patterns.generic;
        if (!pattern.test(input)) {
            throw new ValidationError(message);
        }
    },

    /**
     * Custom validator function
     * @param {Function} fn - Async function (input) => throws ValidationError if invalid
     * @returns {Function} Validator function
     */
    custom: (fn) => async (input) => {
        await fn(input);
    }
};

/**
 * Combine multiple validators into one
 * @param {...Function} validators - Validator functions
 * @returns {Function} Combined validator
 */
function combineValidators(...validators) {
    return async (input) => {
        for (const validator of validators) {
            await validator(input);
        }
    };
}

/**
 * Make a validator optional (only validate if input is not empty)
 * @param {Function} validator - Validator function
 * @returns {Function} Optional validator
 */
function optional(validator) {
    return async (input) => {
        if (input && input.trim() !== '') {
            await validator(input);
        }
    };
}

/**
 * Create a conditional validator
 * @param {Function} condition - (input, context) => boolean
 * @param {Function} validator - Validator to apply if condition is true
 * @returns {Function} Conditional validator
 */
function when(condition, validator) {
    return async (input, context) => {
        if (await condition(input, context)) {
            await validator(input, context);
        }
    };
}

module.exports = {
    Validators,
    createValidator,
    combineValidators,
    optional,
    when,
    ValidationError
};
