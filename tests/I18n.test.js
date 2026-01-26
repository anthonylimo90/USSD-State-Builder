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

describe('I18n Caching', () => {
    let i18n;

    beforeEach(() => {
        i18n = new I18n({ cacheSize: 100 });
        i18n.addTranslations('en', {
            greeting: 'Hello',
            welcome: 'Welcome, {{name}}!',
            counter: '{{count}} items'
        });
    });

    test('should cache translation results', () => {
        // First call - cache miss
        const result1 = i18n.t('greeting');
        const stats1 = i18n.getCacheStats();
        expect(stats1.misses).toBe(1);

        // Second call - cache hit
        const result2 = i18n.t('greeting');
        const stats2 = i18n.getCacheStats();
        expect(stats2.hits).toBe(1);
        expect(result1).toBe(result2);
    });

    test('should cache interpolated translations', () => {
        // First call
        i18n.t('welcome', { params: { name: 'John' } });
        const stats1 = i18n.getCacheStats();
        expect(stats1.misses).toBe(1);

        // Same params - cache hit
        i18n.t('welcome', { params: { name: 'John' } });
        const stats2 = i18n.getCacheStats();
        expect(stats2.hits).toBe(1);

        // Different params - cache miss
        i18n.t('welcome', { params: { name: 'Jane' } });
        const stats3 = i18n.getCacheStats();
        expect(stats3.misses).toBe(2);
    });

    test('should clear cache when adding translations', () => {
        i18n.t('greeting');
        expect(i18n.getCacheStats().size).toBe(1);

        i18n.addTranslations('en', { newKey: 'New Value' });
        expect(i18n.getCacheStats().size).toBe(0);
    });

    test('should clear cache when clearing translations', () => {
        i18n.t('greeting');
        expect(i18n.getCacheStats().size).toBe(1);

        i18n.clearTranslations();
        expect(i18n.getCacheStats().size).toBe(0);
    });

    test('should respect custom cache size', () => {
        const smallCache = new I18n({ cacheSize: 2 });
        smallCache.addTranslations('en', {
            a: 'A', b: 'B', c: 'C', d: 'D'
        });

        // Fill cache
        smallCache.t('a');
        smallCache.t('b');
        expect(smallCache.getCacheStats().size).toBe(2);

        // This should trigger eviction
        smallCache.t('c');
        expect(smallCache.getCacheStats().size).toBe(2);
        expect(smallCache.getCacheStats().evictions).toBe(1);
    });

    test('should report cache hit rate', () => {
        i18n.t('greeting'); // miss
        i18n.t('greeting'); // hit
        i18n.t('greeting'); // hit

        const stats = i18n.getCacheStats();
        expect(stats.hitRate).toBe('66.67%');
    });
});

describe('I18n Formatters', () => {
    let i18n;

    beforeEach(() => {
        i18n = new I18n();
        i18n.addTranslations('en', {
            uppercased: 'Name: {{name | uppercase}}',
            lowercased: 'Name: {{name | lowercase}}',
            capitalized: 'Name: {{name | capitalize}}',
            priced: 'Cost: {{amount | currency}}',
            counted: 'Total: {{value | number}}',
            dated: 'Date: {{day | date}}'
        });
    });

    test('should apply uppercase formatter via interpolation', () => {
        const result = i18n.t('uppercased', { params: { name: 'john' } });
        expect(result).toBe('Name: JOHN');
    });

    test('should apply lowercase formatter via interpolation', () => {
        const result = i18n.t('lowercased', { params: { name: 'JOHN' } });
        expect(result).toBe('Name: john');
    });

    test('should apply capitalize formatter via interpolation', () => {
        const result = i18n.t('capitalized', { params: { name: 'john' } });
        expect(result).toBe('Name: John');
    });

    test('should apply capitalize formatter to empty string', () => {
        i18n.addTranslations('en', { cap: '{{val | capitalize}}' });
        const result = i18n.t('cap', { params: { val: '' } });
        expect(result).toBe('');
    });

    test('should apply currency formatter via interpolation', () => {
        const result = i18n.t('priced', { params: { amount: 9.99 } });
        expect(result).toContain('9.99');
    });

    test('should apply number formatter via interpolation', () => {
        const result = i18n.t('counted', { params: { value: 1234567 } });
        expect(result).toBe('Total: 1,234,567');
    });

    test('should apply date formatter via interpolation', () => {
        const result = i18n.t('dated', { params: { day: new Date('2024-06-15') } });
        expect(result).toContain('6');
        expect(result).toContain('15');
        // Short date format may use 2-digit year
        expect(result).toMatch(/24/);
    });

    test('should call currency formatter directly with options', () => {
        const formatted = i18n.formatters.currency(1500, { currency: 'USD', locale: 'en-US' });
        expect(formatted).toContain('1,500');
    });

    test('should call number formatter directly with custom locale', () => {
        const formatted = i18n.formatters.number(1000.5, { locale: 'en-US' });
        expect(formatted).toContain('1,000');
    });

    test('should call date formatter directly with a string date', () => {
        const formatted = i18n.formatters.date('2024-01-15', { locale: 'en-US', format: 'short' });
        expect(formatted).toContain('1');
        expect(formatted).toContain('15');
    });

    test('should call date formatter directly with Date object', () => {
        const date = new Date('2024-12-25');
        const formatted = i18n.formatters.date(date, { locale: 'en-US', format: 'medium' });
        expect(formatted).toContain('25');
        expect(formatted).toContain('2024');
    });

    test('should add and use a custom formatter', () => {
        i18n.addFormatter('reverse', (value) => String(value).split('').reverse().join(''));
        i18n.addTranslations('en', { reversed: '{{word | reverse}}' });
        const result = i18n.t('reversed', { params: { word: 'hello' } });
        expect(result).toBe('olleh');
    });

    test('should keep original placeholder when formatter value is undefined', () => {
        const result = i18n.t('uppercased', { params: {} });
        expect(result).toBe('Name: {{name | uppercase}}');
    });

    test('should keep original placeholder when formatter does not exist', () => {
        i18n.addTranslations('en', { bad: '{{val | nonexistent}}' });
        const result = i18n.t('bad', { params: { val: 'test' } });
        expect(result).toBe('{{val | nonexistent}}');
    });
});

describe('I18n Pluralization Rules', () => {
    let i18n;

    beforeEach(() => {
        i18n = new I18n();
        i18n.addTranslations('en', {
            'message_zero': 'No messages',
            'message_one': '{{count}} message',
            'message_two': '{{count}} messages (pair)',
            'message_few': '{{count}} messages (few)',
            'message_many': '{{count}} messages (many)',
            'message_other': '{{count}} messages (lots)'
        });
    });

    test('should use zero form when count is 0', () => {
        expect(i18n.t('message', { count: 0 })).toBe('No messages');
    });

    test('should use one form when count is 1', () => {
        expect(i18n.t('message', { count: 1 })).toBe('1 message');
    });

    test('should use two form when count is 2', () => {
        expect(i18n.t('message', { count: 2 })).toBe('2 messages (pair)');
    });

    test('should use few form when count is 3', () => {
        expect(i18n.t('message', { count: 3 })).toBe('3 messages (few)');
    });

    test('should use few form when count is 10', () => {
        expect(i18n.t('message', { count: 10 })).toBe('10 messages (few)');
    });

    test('should use many form when count is 11', () => {
        expect(i18n.t('message', { count: 11 })).toBe('11 messages (many)');
    });

    test('should use many form when count is 50', () => {
        expect(i18n.t('message', { count: 50 })).toBe('50 messages (many)');
    });

    test('should use many form when count is 99', () => {
        expect(i18n.t('message', { count: 99 })).toBe('99 messages (many)');
    });

    test('should use other form when count is 100', () => {
        expect(i18n.t('message', { count: 100 })).toBe('100 messages (lots)');
    });

    test('should use other form when count is 1000', () => {
        expect(i18n.t('message', { count: 1000 })).toBe('1000 messages (lots)');
    });

    test('should fall back to base key when specific plural form is missing', () => {
        const i18nSimple = new I18n();
        i18nSimple.addTranslations('en', {
            'item_one': '{{count}} item',
            'item': '{{count}} items (default)'
        });
        // count=5 triggers "few", which does not exist, so it falls back to base key "item"
        expect(i18nSimple.t('item', { count: 5 })).toBe('5 items (default)');
    });
});

describe('LanguageDetector - Additional Phone Prefixes', () => {
    test('should detect Amharic from Ethiopian number (+251)', () => {
        expect(LanguageDetector.fromPhoneNumber('+251911234567')).toBe('am');
    });

    test('should detect Arabic from Saudi number (+966)', () => {
        expect(LanguageDetector.fromPhoneNumber('+966501234567')).toBe('ar');
    });

    test('should detect Arabic from UAE number (+971)', () => {
        expect(LanguageDetector.fromPhoneNumber('+971501234567')).toBe('ar');
    });

    test('should detect Arabic from Egyptian number (+20)', () => {
        expect(LanguageDetector.fromPhoneNumber('+201001234567')).toBe('ar');
    });

    test('should detect Arabic from Sudanese number (+249)', () => {
        expect(LanguageDetector.fromPhoneNumber('+249912345678')).toBe('ar');
    });

    test('should detect Portuguese from Mozambican number (+258)', () => {
        expect(LanguageDetector.fromPhoneNumber('+258841234567')).toBe('pt');
    });

    test('should detect Portuguese from Angolan number (+244)', () => {
        expect(LanguageDetector.fromPhoneNumber('+244921234567')).toBe('pt');
    });

    test('should detect Hausa from Nigerian number (+234)', () => {
        expect(LanguageDetector.fromPhoneNumber('+234801234567')).toBe('ha');
    });

    test('should detect English from Ugandan number (+256)', () => {
        expect(LanguageDetector.fromPhoneNumber('+256701234567')).toBe('en');
    });

    test('should detect English from Ghanaian number (+233)', () => {
        expect(LanguageDetector.fromPhoneNumber('+233201234567')).toBe('en');
    });

    test('should detect English from South African number (+27)', () => {
        expect(LanguageDetector.fromPhoneNumber('+27821234567')).toBe('en');
    });

    test('should detect French from Ivorian number (+225)', () => {
        expect(LanguageDetector.fromPhoneNumber('+225071234567')).toBe('fr');
    });

    test('should detect French from Cameroonian number (+237)', () => {
        expect(LanguageDetector.fromPhoneNumber('+237671234567')).toBe('fr');
    });

    test('should detect French from DRC number (+243)', () => {
        expect(LanguageDetector.fromPhoneNumber('+243811234567')).toBe('fr');
    });

    test('should handle phone numbers with spaces and dashes', () => {
        expect(LanguageDetector.fromPhoneNumber('+251 91-123-4567')).toBe('am');
        expect(LanguageDetector.fromPhoneNumber('+966-50-123-4567')).toBe('ar');
    });
});

describe('LanguageDetector - fromUSSDCode', () => {
    test('should detect language from USSD code using provided map', () => {
        const codeMap = {
            '*123#': 'en',
            '*456#': 'sw',
            '*789#': 'fr'
        };
        expect(LanguageDetector.fromUSSDCode('*123#', codeMap)).toBe('en');
        expect(LanguageDetector.fromUSSDCode('*456#', codeMap)).toBe('sw');
        expect(LanguageDetector.fromUSSDCode('*789#', codeMap)).toBe('fr');
    });

    test('should return null for unknown USSD code', () => {
        expect(LanguageDetector.fromUSSDCode('*999#', { '*123#': 'en' })).toBeNull();
    });

    test('should return null when no code map is provided', () => {
        expect(LanguageDetector.fromUSSDCode('*123#')).toBeNull();
    });
});

describe('I18n Language Fallback Behavior', () => {
    test('should fall back to fallbackLanguage when key is missing in requested language', () => {
        const i18n = new I18n({ defaultLanguage: 'fr', fallbackLanguage: 'en' });
        i18n.addTranslations('en', { greeting: 'Hello' });
        i18n.addTranslations('fr', { farewell: 'Au revoir' });

        // 'greeting' is missing in fr, should fall back to en
        expect(i18n.t('greeting')).toBe('Hello');
    });

    test('should use requested language over fallback when key exists in both', () => {
        const i18n = new I18n({ defaultLanguage: 'en', fallbackLanguage: 'en' });
        i18n.addTranslations('en', { greeting: 'Hello' });
        i18n.addTranslations('sw', { greeting: 'Habari' });

        expect(i18n.t('greeting', { language: 'sw' })).toBe('Habari');
    });

    test('should return key when translation missing from both requested and fallback language', () => {
        const i18n = new I18n({ defaultLanguage: 'fr', fallbackLanguage: 'en' });
        i18n.addTranslations('en', { greeting: 'Hello' });
        i18n.addTranslations('fr', { farewell: 'Au revoir' });

        expect(i18n.t('nonexistent')).toBe('nonexistent');
    });

    test('should not attempt fallback when requested language equals fallback language', () => {
        const i18n = new I18n({ defaultLanguage: 'en', fallbackLanguage: 'en' });
        i18n.addTranslations('en', { greeting: 'Hello' });

        // Missing key with same language as fallback
        expect(i18n.t('missing', { language: 'en' })).toBe('missing');
    });

    test('should use custom fallbackLanguage different from defaultLanguage', () => {
        const i18n = new I18n({ defaultLanguage: 'ha', fallbackLanguage: 'sw' });
        i18n.addTranslations('sw', { greeting: 'Habari' });

        // ha has no translations, should fall back to sw
        expect(i18n.t('greeting')).toBe('Habari');
    });
});

describe('I18n Missing Translation Key Handling', () => {
    let i18n;

    beforeEach(() => {
        i18n = new I18n();
        i18n.addTranslations('en', { existing: 'I exist' });
    });

    test('should return the key itself when translation is missing and no defaultValue', () => {
        expect(i18n.t('some.deeply.nested.missing.key')).toBe('some.deeply.nested.missing.key');
    });

    test('should return defaultValue when translation is missing', () => {
        expect(i18n.t('missing', { defaultValue: 'Fallback text' })).toBe('Fallback text');
    });

    test('should interpolate params in defaultValue', () => {
        const result = i18n.t('missing', {
            defaultValue: 'Hello, {{name}}!',
            params: { name: 'User' }
        });
        expect(result).toBe('Hello, User!');
    });

    test('should use translate() alias identically to t()', () => {
        expect(i18n.translate('existing')).toBe('I exist');
        expect(i18n.translate('absent.key')).toBe('absent.key');
    });

    test('should use translate() alias with defaultValue', () => {
        // Use a unique key to avoid cache collision
        expect(i18n.translate('never.seen', { defaultValue: 'nope' })).toBe('nope');
    });

    test('should handle hasTranslation for fallback language', () => {
        const i18n2 = new I18n({ defaultLanguage: 'sw', fallbackLanguage: 'en' });
        i18n2.addTranslations('en', { greeting: 'Hello' });

        // hasTranslation checks with passed language (sw), which is missing,
        // but _getTranslation tries fallback
        expect(i18n2.hasTranslation('greeting', 'sw')).toBe(true);
    });

    test('should handle hasTranslation returning false for completely absent key', () => {
        expect(i18n.hasTranslation('totally.absent')).toBe(false);
    });
});

describe('I18n Interpolation Edge Cases', () => {
    let i18n;

    beforeEach(() => {
        i18n = new I18n();
    });

    test('should handle null text in interpolation gracefully', () => {
        // _interpolate with non-string returns the value as-is
        const result = i18n._interpolate(null, {});
        expect(result).toBeNull();
    });

    test('should handle text without placeholders efficiently', () => {
        const result = i18n._interpolate('No placeholders here', { name: 'test' });
        expect(result).toBe('No placeholders here');
    });

    test('should handle numeric param values', () => {
        i18n.addTranslations('en', { msg: 'Value is {{val}}' });
        expect(i18n.t('msg', { params: { val: 42 } })).toBe('Value is 42');
    });

    test('should handle count in interpolation alongside params', () => {
        i18n.addTranslations('en', {
            'order_one': '{{count}} order for {{name}}',
            'order_other': '{{count}} orders for {{name}}'
        });
        expect(i18n.t('order', { count: 1, params: { name: 'Alice' } })).toBe('1 order for Alice');
        expect(i18n.t('order', { count: 200, params: { name: 'Bob' } })).toBe('200 orders for Bob');
    });
});

describe('createUSSDI18n - Extended Languages', () => {
    let i18n;

    beforeEach(() => {
        i18n = createUSSDI18n();
    });

    test('should have Amharic translations', () => {
        expect(i18n.t('common.welcome', { language: 'am' })).toBe('እንኳን ደህና መጡ');
        expect(i18n.t('common.goodbye', { language: 'am' })).toBe('ደህና ሁኑ');
        expect(i18n.t('common.thankYou', { language: 'am' })).toBe('አመሰግናለሁ');
        expect(i18n.t('validation.required', { language: 'am' })).toBe('ይህ መስክ ያስፈልጋል');
    });

    test('should have Arabic translations', () => {
        expect(i18n.t('common.welcome', { language: 'ar' })).toBe('مرحباً');
        expect(i18n.t('common.goodbye', { language: 'ar' })).toBe('مع السلامة');
        expect(i18n.t('common.yes', { language: 'ar' })).toBe('نعم');
        expect(i18n.t('common.no', { language: 'ar' })).toBe('لا');
        expect(i18n.t('validation.invalidPhone', { language: 'ar' })).toBe('رقم هاتف غير صالح');
    });

    test('should have Portuguese translations', () => {
        expect(i18n.t('common.welcome', { language: 'pt' })).toBe('Bem-vindo');
        expect(i18n.t('common.goodbye', { language: 'pt' })).toBe('Adeus');
        expect(i18n.t('common.thankYou', { language: 'pt' })).toBe('Obrigado');
        expect(i18n.t('validation.required', { language: 'pt' })).toBe('Este campo é obrigatório');
    });

    test('should have Hausa translations', () => {
        expect(i18n.t('common.welcome', { language: 'ha' })).toBe('Barka da zuwa');
        expect(i18n.t('common.goodbye', { language: 'ha' })).toBe('Sai an jima');
        expect(i18n.t('common.yes', { language: 'ha' })).toBe('Eh');
        expect(i18n.t('validation.required', { language: 'ha' })).toBe('Ana buƙatar wannan filin');
    });

    test('should include all expected languages', () => {
        const languages = i18n.getLanguages();
        expect(languages).toContain('en');
        expect(languages).toContain('sw');
        expect(languages).toContain('fr');
        expect(languages).toContain('am');
        expect(languages).toContain('ar');
        expect(languages).toContain('pt');
        expect(languages).toContain('ha');
    });

    test('should accept custom options and merge them', () => {
        const custom = createUSSDI18n({ defaultLanguage: 'fr' });
        expect(custom.getDefaultLanguage()).toBe('fr');
        // Should still have default translations
        expect(custom.t('common.welcome')).toBe('Bienvenue');
    });

    test('should fall back to English for missing keys in other languages', () => {
        // All languages have common.welcome, but test a key only in en
        i18n.addTranslations('en', { 'custom.onlyEnglish': 'English only' });
        expect(i18n.t('custom.onlyEnglish', { language: 'sw' })).toBe('English only');
        expect(i18n.t('custom.onlyEnglish', { language: 'ar' })).toBe('English only');
    });

    test('should support all common validation keys across languages', () => {
        const validationKeys = [
            'validation.required',
            'validation.invalidPhone',
            'validation.invalidEmail',
            'validation.invalidAmount',
            'validation.tooShort',
            'validation.tooLong'
        ];
        const languages = ['en', 'sw', 'fr', 'am', 'ar', 'pt', 'ha'];

        for (const lang of languages) {
            for (const key of validationKeys) {
                const result = i18n.t(key, { language: lang });
                // Should not return the key itself (meaning translation exists)
                expect(result).not.toBe(key);
            }
        }
    });
});

describe('I18n Additional Utility Methods', () => {
    test('should load translations from a bulk object', () => {
        const i18n = new I18n();
        i18n.loadTranslations({
            en: { greeting: 'Hello' },
            sw: { greeting: 'Habari' },
            fr: { greeting: 'Bonjour' }
        });

        expect(i18n.t('greeting', { language: 'en' })).toBe('Hello');
        expect(i18n.t('greeting', { language: 'sw' })).toBe('Habari');
        expect(i18n.t('greeting', { language: 'fr' })).toBe('Bonjour');
    });

    test('should export all translations', () => {
        const i18n = new I18n();
        i18n.addTranslations('en', { greeting: 'Hello' });
        i18n.addTranslations('sw', { greeting: 'Habari' });

        const exported = i18n.exportTranslations();
        expect(exported).toHaveProperty('en');
        expect(exported).toHaveProperty('sw');
        expect(exported.en.greeting).toBe('Hello');
    });

    test('exportTranslations should return a shallow copy', () => {
        const i18n = new I18n();
        i18n.addTranslations('en', { greeting: 'Hello' });

        const exported = i18n.exportTranslations();
        exported.de = { greeting: 'Hallo' };

        // Original should not be affected
        expect(i18n.getLanguages()).not.toContain('de');
    });

    test('should clear all translations', () => {
        const i18n = new I18n();
        i18n.addTranslations('en', { greeting: 'Hello' });
        i18n.clearTranslations();

        expect(i18n.getLanguages()).toHaveLength(0);
        expect(i18n.t('greeting')).toBe('greeting');
    });

    test('should chain addTranslations calls', () => {
        const i18n = new I18n();
        const result = i18n
            .addTranslations('en', { a: 'A' })
            .addTranslations('sw', { a: 'AA' })
            .setDefaultLanguage('sw');

        expect(result).toBeInstanceOf(I18n);
        expect(result.t('a')).toBe('AA');
    });

    test('should merge translations for the same language', () => {
        const i18n = new I18n();
        i18n.addTranslations('en', { greeting: 'Hello' });
        i18n.addTranslations('en', { farewell: 'Goodbye' });

        expect(i18n.t('greeting')).toBe('Hello');
        expect(i18n.t('farewell')).toBe('Goodbye');
    });

    test('should override existing translation when re-added', () => {
        const i18n = new I18n();
        i18n.addTranslations('en', { greeting: 'Hello' });
        i18n.addTranslations('en', { greeting: 'Hi there' });

        expect(i18n.t('greeting')).toBe('Hi there');
    });

    test('should create a namespaced translator', () => {
        const i18n = new I18n();
        i18n.addTranslations('en', {
            menu: {
                title: 'Main Menu',
                subtitle: 'Choose an option'
            }
        });

        const menu = i18n.ns('menu');
        expect(menu('title')).toBe('Main Menu');
        expect(menu('subtitle')).toBe('Choose an option');
    });

    test('should create namespaced translator that accepts options', () => {
        const i18n = new I18n();
        i18n.addTranslations('en', { 'greet.hello': 'Hello, {{name}}!' });
        i18n.addTranslations('sw', { 'greet.hello': 'Habari, {{name}}!' });

        const greet = i18n.ns('greet');
        expect(greet('hello', { params: { name: 'World' } })).toBe('Hello, World!');
        expect(greet('hello', { language: 'sw', params: { name: 'Dunia' } })).toBe('Habari, Dunia!');
    });
});

describe('I18n Constructor Defaults', () => {
    test('should use default options when none provided', () => {
        const i18n = new I18n();
        expect(i18n.getDefaultLanguage()).toBe('en');
        expect(i18n.fallbackLanguage).toBe('en');
        expect(i18n.getLanguages()).toHaveLength(0);
    });

    test('should accept initial translations in constructor', () => {
        const i18n = new I18n({
            translations: {
                en: { greeting: 'Hello' }
            }
        });
        expect(i18n.t('greeting')).toBe('Hello');
    });

    test('should accept custom defaultLanguage and fallbackLanguage', () => {
        const i18n = new I18n({
            defaultLanguage: 'fr',
            fallbackLanguage: 'sw'
        });
        expect(i18n.getDefaultLanguage()).toBe('fr');
        expect(i18n.fallbackLanguage).toBe('sw');
    });
});
