/**
 * Internationalization (i18n) Support for USSD State Machine
 * 
 * Provides multi-language support for USSD applications.
 */

/**
 * Translation Manager
 * 
 * Manages translations for multiple languages with fallback support.
 */
class I18n {
    /**
     * Create a new I18n instance
     * @param {Object} options - Configuration options
     * @param {string} [options.defaultLanguage='en'] - Default language code
     * @param {string} [options.fallbackLanguage='en'] - Fallback language code
     * @param {Object} [options.translations={}] - Initial translations
     */
    constructor(options = {}) {
        this.defaultLanguage = options.defaultLanguage || 'en';
        this.fallbackLanguage = options.fallbackLanguage || 'en';
        this.translations = options.translations || {};
        this.pluralRules = {};
        this.formatters = {};

        // Initialize default formatters
        this._initDefaultFormatters();
    }

    /**
     * Initialize default formatters
     * @private
     */
    _initDefaultFormatters() {
        this.formatters = {
            uppercase: (value) => String(value).toUpperCase(),
            lowercase: (value) => String(value).toLowerCase(),
            capitalize: (value) => {
                const str = String(value);
                return str.charAt(0).toUpperCase() + str.slice(1);
            },
            currency: (value, options = {}) => {
                const { currency = 'USD', locale = 'en-US' } = options;
                return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
            },
            number: (value, options = {}) => {
                const { locale = 'en-US' } = options;
                return new Intl.NumberFormat(locale).format(value);
            },
            date: (value, options = {}) => {
                const { locale = 'en-US', format = 'short' } = options;
                const date = value instanceof Date ? value : new Date(value);
                return new Intl.DateTimeFormat(locale, { dateStyle: format }).format(date);
            }
        };
    }

    /**
     * Add translations for a language
     * @param {string} language - Language code (e.g., 'en', 'sw', 'fr')
     * @param {Object} translations - Translation key-value pairs
     * @returns {I18n} this for chaining
     */
    addTranslations(language, translations) {
        this.translations[language] = {
            ...this.translations[language],
            ...this._flattenObject(translations)
        };
        return this;
    }

    /**
     * Load translations from an object
     * @param {Object} allTranslations - Object with language codes as keys
     * @returns {I18n} this for chaining
     */
    loadTranslations(allTranslations) {
        for (const [language, translations] of Object.entries(allTranslations)) {
            this.addTranslations(language, translations);
        }
        return this;
    }

    /**
     * Flatten nested object keys with dots
     * @private
     */
    _flattenObject(obj, prefix = '') {
        const result = {};

        for (const [key, value] of Object.entries(obj)) {
            const newKey = prefix ? `${prefix}.${key}` : key;

            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                Object.assign(result, this._flattenObject(value, newKey));
            } else {
                result[newKey] = value;
            }
        }

        return result;
    }

    /**
     * Get translation for a key
     * @param {string} key - Translation key (supports dot notation)
     * @param {Object} [options] - Translation options
     * @param {string} [options.language] - Language code
     * @param {Object} [options.params] - Interpolation parameters
     * @param {number} [options.count] - Count for pluralization
     * @param {string} [options.defaultValue] - Default value if not found
     * @returns {string} Translated string
     */
    t(key, options = {}) {
        const language = options.language || this.defaultLanguage;
        const params = options.params || {};
        const count = options.count;
        const defaultValue = options.defaultValue || key;

        // Get plural key if count is provided
        let translationKey = key;
        if (count !== undefined) {
            translationKey = this._getPluralKey(key, count, language);
        }

        // Try to get translation
        let translation = this._getTranslation(translationKey, language);

        // Fall back to default value if not found
        if (translation === null) {
            translation = defaultValue;
        }

        // Interpolate parameters
        translation = this._interpolate(translation, { ...params, count });

        return translation;
    }

    /**
     * Alias for t()
     */
    translate(key, options) {
        return this.t(key, options);
    }

    /**
     * Get translation from language or fallback
     * @private
     */
    _getTranslation(key, language) {
        // Try specified language
        if (this.translations[language]?.[key]) {
            return this.translations[language][key];
        }

        // Try fallback language
        if (language !== this.fallbackLanguage && this.translations[this.fallbackLanguage]?.[key]) {
            return this.translations[this.fallbackLanguage][key];
        }

        return null;
    }

    /**
     * Get pluralized key
     * @private
     */
    _getPluralKey(key, count, language) {
        const pluralForm = this._getPluralForm(count, language);
        const pluralKey = `${key}_${pluralForm}`;

        // Check if plural form exists
        if (this._getTranslation(pluralKey, language)) {
            return pluralKey;
        }

        // Fallback to base key
        return key;
    }

    /**
     * Get plural form for a count
     * @private
     */
    _getPluralForm(count, language) {
        // Simple plural rules (can be extended)
        if (count === 0) return 'zero';
        if (count === 1) return 'one';
        if (count === 2) return 'two';
        if (count >= 3 && count <= 10) return 'few';
        if (count >= 11 && count <= 99) return 'many';
        return 'other';
    }

    /**
     * Interpolate parameters in translation
     * @private
     */
    _interpolate(text, params) {
        if (!text || typeof text !== 'string') return text;

        return text.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
            const trimmed = expression.trim();

            // Check for formatter: {{value | formatter}}
            if (trimmed.includes('|')) {
                const [varPart, formatterPart] = trimmed.split('|').map(s => s.trim());
                const value = params[varPart];
                const formatter = this.formatters[formatterPart];

                if (formatter && value !== undefined) {
                    return formatter(value);
                }
            }

            // Simple variable replacement
            const value = params[trimmed];
            return value !== undefined ? value : match;
        });
    }

    /**
     * Add a custom formatter
     * @param {string} name - Formatter name
     * @param {Function} formatter - Formatter function (value, options) => string
     * @returns {I18n} this for chaining
     */
    addFormatter(name, formatter) {
        this.formatters[name] = formatter;
        return this;
    }

    /**
     * Check if a translation exists
     * @param {string} key - Translation key
     * @param {string} [language] - Language code
     * @returns {boolean} Whether translation exists
     */
    hasTranslation(key, language) {
        return this._getTranslation(key, language || this.defaultLanguage) !== null;
    }

    /**
     * Get all available languages
     * @returns {string[]} Array of language codes
     */
    getLanguages() {
        return Object.keys(this.translations);
    }

    /**
     * Set the default language
     * @param {string} language - Language code
     * @returns {I18n} this for chaining
     */
    setDefaultLanguage(language) {
        this.defaultLanguage = language;
        return this;
    }

    /**
     * Get the current default language
     * @returns {string} Default language code
     */
    getDefaultLanguage() {
        return this.defaultLanguage;
    }

    /**
     * Create a bound translator for a specific language
     * @param {string} language - Language code
     * @returns {Function} Translator function (key, options) => string
     */
    createTranslator(language) {
        return (key, options = {}) => this.t(key, { ...options, language });
    }

    /**
     * Create translations namespace
     * @param {string} namespace - Namespace prefix
     * @returns {Function} Namespaced translator (key, options) => string
     */
    ns(namespace) {
        return (key, options = {}) => this.t(`${namespace}.${key}`, options);
    }

    /**
     * Export all translations
     * @returns {Object} All translations
     */
    exportTranslations() {
        return { ...this.translations };
    }

    /**
     * Clear all translations
     */
    clearTranslations() {
        this.translations = {};
    }
}

/**
 * Create a pre-configured i18n instance for USSD
 */
function createUSSDI18n(options = {}) {
    const i18n = new I18n(options);

    // Add common USSD translations
    i18n.addTranslations('en', {
        common: {
            welcome: 'Welcome',
            goodbye: 'Goodbye',
            thankYou: 'Thank you',
            error: 'An error occurred',
            invalidInput: 'Invalid input',
            tryAgain: 'Please try again',
            back: 'Back',
            next: 'Next',
            cancel: 'Cancel',
            confirm: 'Confirm',
            yes: 'Yes',
            no: 'No',
            select: 'Select an option',
            enter: 'Enter',
            loading: 'Please wait...',
            timeout: 'Session expired',
            mainMenu: 'Main Menu'
        },
        validation: {
            required: 'This field is required',
            invalidPhone: 'Invalid phone number',
            invalidEmail: 'Invalid email address',
            invalidAmount: 'Invalid amount',
            tooShort: 'Input too short',
            tooLong: 'Input too long'
        }
    });

    // Swahili translations (common in East Africa)
    i18n.addTranslations('sw', {
        common: {
            welcome: 'Karibu',
            goodbye: 'Kwaheri',
            thankYou: 'Asante',
            error: 'Kosa limetokea',
            invalidInput: 'Ingizo batili',
            tryAgain: 'Tafadhali jaribu tena',
            back: 'Rudi',
            next: 'Endelea',
            cancel: 'Ghairi',
            confirm: 'Thibitisha',
            yes: 'Ndiyo',
            no: 'Hapana',
            select: 'Chagua chaguo',
            enter: 'Weka',
            loading: 'Tafadhali subiri...',
            timeout: 'Muda umekwisha',
            mainMenu: 'Menyu Kuu'
        },
        validation: {
            required: 'Sehemu hii inahitajika',
            invalidPhone: 'Nambari ya simu si sahihi',
            invalidEmail: 'Barua pepe si sahihi',
            invalidAmount: 'Kiasi si sahihi',
            tooShort: 'Ingizo ni fupi sana',
            tooLong: 'Ingizo ni refu sana'
        }
    });

    // French translations (common in West/Central Africa)
    i18n.addTranslations('fr', {
        common: {
            welcome: 'Bienvenue',
            goodbye: 'Au revoir',
            thankYou: 'Merci',
            error: 'Une erreur est survenue',
            invalidInput: 'Entrée invalide',
            tryAgain: 'Veuillez réessayer',
            back: 'Retour',
            next: 'Suivant',
            cancel: 'Annuler',
            confirm: 'Confirmer',
            yes: 'Oui',
            no: 'Non',
            select: 'Sélectionnez une option',
            enter: 'Entrez',
            loading: 'Veuillez patienter...',
            timeout: 'Session expirée',
            mainMenu: 'Menu Principal'
        },
        validation: {
            required: 'Ce champ est obligatoire',
            invalidPhone: 'Numéro de téléphone invalide',
            invalidEmail: 'Adresse email invalide',
            invalidAmount: 'Montant invalide',
            tooShort: 'Entrée trop courte',
            tooLong: 'Entrée trop longue'
        }
    });

    return i18n;
}

/**
 * Language detection utilities
 */
const LanguageDetector = {
    /**
     * Detect language from phone number prefix
     * @param {string} phoneNumber - Phone number
     * @returns {string|null} Language code or null
     */
    fromPhoneNumber(phoneNumber) {
        const cleaned = phoneNumber.replace(/[^\d+]/g, '');

        // Country code to language mapping
        const prefixMap = {
            '+254': 'en', // Kenya
            '+255': 'sw', // Tanzania
            '+256': 'en', // Uganda
            '+234': 'en', // Nigeria
            '+233': 'en', // Ghana
            '+27': 'en', // South Africa
            '+225': 'fr', // Côte d'Ivoire
            '+221': 'fr', // Senegal
            '+237': 'fr', // Cameroon
            '+243': 'fr', // DRC
        };

        for (const [prefix, lang] of Object.entries(prefixMap)) {
            if (cleaned.startsWith(prefix)) {
                return lang;
            }
        }

        return null;
    },

    /**
     * Detect language from USSD code
     * @param {string} ussdCode - USSD code
     * @param {Object} codeMap - Map of codes to languages
     * @returns {string|null} Language code or null
     */
    fromUSSDCode(ussdCode, codeMap = {}) {
        return codeMap[ussdCode] || null;
    }
};

module.exports = {
    I18n,
    createUSSDI18n,
    LanguageDetector
};
