const { I18n, createUSSDI18n, LanguageDetector } = require('../lib/I18n');

describe('I18n', () => {
    let i18n;

    beforeEach(() => {
        i18n = new I18n();
        i18n.addTranslations('en', {
            greeting: 'Hello',
            welcome: 'Welcome, {{name}}!',
            items: {
                one: '{{count}} item',
                other: '{{count}} items'
            },
            formatted: 'Price: {{amount | currency}}'
        });
        i18n.addTranslations('sw', {
            greeting: 'Habari'
        });
    });

    describe('Basic translation', () => {
        test('should translate simple key', () => {
            expect(i18n.t('greeting')).toBe('Hello');
        });

        test('should translate with different language', () => {
            expect(i18n.t('greeting', { language: 'sw' })).toBe('Habari');
        });

        test('should fall back to default language', () => {
            expect(i18n.t('welcome', { language: 'sw' })).toBe('Welcome, {{name}}!');
        });

        test('should return key if not found', () => {
            expect(i18n.t('nonexistent')).toBe('nonexistent');
        });

        test('should use default value if not found', () => {
            expect(i18n.t('nonexistent', { defaultValue: 'Default' })).toBe('Default');
        });
    });

    describe('Interpolation', () => {
        test('should interpolate parameters', () => {
            expect(i18n.t('welcome', { params: { name: 'John' } }))
                .toBe('Welcome, John!');
        });

        test('should keep placeholder if param not provided', () => {
            expect(i18n.t('welcome', { params: {} })).toBe('Welcome, {{name}}!');
        });
    });

    describe('Pluralization', () => {
        test('should use singular form', () => {
            const i18nPlural = new I18n();
            i18nPlural.addTranslations('en', {
                'items_one': '{{count}} item',
                'items_other': '{{count}} items'
            });
            expect(i18nPlural.t('items', { count: 1 })).toBe('1 item');
        });

        test('should use plural form', () => {
            const i18nPlural = new I18n();
            i18nPlural.addTranslations('en', {
                'items_one': '{{count}} item',
                'items_other': '{{count}} items'
            });
            // count: 100+ triggers 'other' form
            expect(i18nPlural.t('items', { count: 100 })).toBe('100 items');
        });
    });

    describe('Nested keys', () => {
        test('should handle nested translations', () => {
            i18n.addTranslations('en', {
                menu: {
                    title: 'Main Menu',
                    options: {
                        one: 'Option 1'
                    }
                }
            });
            expect(i18n.t('menu.title')).toBe('Main Menu');
            expect(i18n.t('menu.options.one')).toBe('Option 1');
        });
    });

    describe('Language management', () => {
        test('should get available languages', () => {
            expect(i18n.getLanguages()).toContain('en');
            expect(i18n.getLanguages()).toContain('sw');
        });

        test('should set default language', () => {
            i18n.setDefaultLanguage('sw');
            expect(i18n.getDefaultLanguage()).toBe('sw');
        });

        test('should check if translation exists', () => {
            expect(i18n.hasTranslation('greeting')).toBe(true);
            expect(i18n.hasTranslation('nonexistent')).toBe(false);
        });
    });

    describe('Bound translator', () => {
        test('should create bound translator', () => {
            const sw = i18n.createTranslator('sw');
            expect(sw('greeting')).toBe('Habari');
        });
    });

    describe('Namespace', () => {
        test('should create namespaced translator', () => {
            i18n.addTranslations('en', {
                'menu.title': 'Menu',
                'menu.options': 'Options'
            });
            const menu = i18n.ns('menu');
            expect(menu('title')).toBe('Menu');
        });
    });
});

describe('createUSSDI18n', () => {
    test('should create i18n with pre-built translations', () => {
        const i18n = createUSSDI18n();

        expect(i18n.t('common.welcome')).toBe('Welcome');
        expect(i18n.t('common.goodbye')).toBe('Goodbye');
        expect(i18n.t('common.back')).toBe('Back');
        expect(i18n.t('validation.required')).toBe('This field is required');
    });

    test('should have Swahili translations', () => {
        const i18n = createUSSDI18n();

        expect(i18n.t('common.welcome', { language: 'sw' })).toBe('Karibu');
        expect(i18n.t('common.goodbye', { language: 'sw' })).toBe('Kwaheri');
    });

    test('should have French translations', () => {
        const i18n = createUSSDI18n();

        expect(i18n.t('common.welcome', { language: 'fr' })).toBe('Bienvenue');
        expect(i18n.t('common.goodbye', { language: 'fr' })).toBe('Au revoir');
    });
});

describe('LanguageDetector', () => {
    describe('fromPhoneNumber', () => {
        test('should detect language from Kenyan number', () => {
            expect(LanguageDetector.fromPhoneNumber('+254712345678')).toBe('en');
        });

        test('should detect language from Tanzanian number', () => {
            expect(LanguageDetector.fromPhoneNumber('+255712345678')).toBe('sw');
        });

        test('should detect language from French-speaking country', () => {
            expect(LanguageDetector.fromPhoneNumber('+221712345678')).toBe('fr');
        });

        test('should return null for unknown prefix', () => {
            expect(LanguageDetector.fromPhoneNumber('+999123456789')).toBeNull();
        });
    });
});
