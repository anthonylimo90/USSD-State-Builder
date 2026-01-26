const {
    Validators,
    createValidator,
    combineValidators,
    optional,
    when
} = require('../lib/ValidationLibrary');
const ValidationError = require('../lib/ValidationError');

describe('ValidationLibrary', () => {
    describe('Validators.required', () => {
        test('should pass for non-empty input', async () => {
            await expect(Validators.required()('hello')).resolves.not.toThrow();
        });

        test('should throw for empty input', async () => {
            await expect(Validators.required()('')).rejects.toThrow(ValidationError);
        });

        test('should throw for whitespace-only input', async () => {
            await expect(Validators.required()('   ')).rejects.toThrow(ValidationError);
        });

        test('should use custom message', async () => {
            await expect(Validators.required('Name required')('')).rejects.toThrow('Name required');
        });
    });

    describe('Validators.minLength', () => {
        test('should pass for input meeting minimum', async () => {
            await expect(Validators.minLength(3)('hello')).resolves.not.toThrow();
        });

        test('should throw for short input', async () => {
            await expect(Validators.minLength(5)('hi')).rejects.toThrow(ValidationError);
        });

        test('should use custom message', async () => {
            await expect(
                Validators.minLength({ length: 5, message: 'Too short!' })('hi')
            ).rejects.toThrow('Too short!');
        });
    });

    describe('Validators.maxLength', () => {
        test('should pass for input under maximum', async () => {
            await expect(Validators.maxLength(10)('hello')).resolves.not.toThrow();
        });

        test('should throw for long input', async () => {
            await expect(Validators.maxLength(3)('hello')).rejects.toThrow(ValidationError);
        });
    });

    describe('Validators.numeric', () => {
        test('should pass for valid number', async () => {
            await expect(Validators.numeric()('123')).resolves.not.toThrow();
        });

        test('should pass for decimal', async () => {
            await expect(Validators.numeric()('12.5')).resolves.not.toThrow();
        });

        test('should throw for non-numeric', async () => {
            await expect(Validators.numeric()('abc')).rejects.toThrow(ValidationError);
        });

        test('should validate min value', async () => {
            await expect(
                Validators.numeric({ min: 10 })('5')
            ).rejects.toThrow(ValidationError);
        });

        test('should validate max value', async () => {
            await expect(
                Validators.numeric({ max: 10 })('15')
            ).rejects.toThrow(ValidationError);
        });

        test('should validate integer requirement', async () => {
            await expect(
                Validators.numeric({ integer: true })('12.5')
            ).rejects.toThrow(ValidationError);
        });
    });

    describe('Validators.phone', () => {
        test('should pass for valid international number', async () => {
            await expect(Validators.phone()('1234567890')).resolves.not.toThrow();
        });

        test('should pass for Kenyan number', async () => {
            await expect(
                Validators.phone({ country: 'KE' })('0712345678')
            ).resolves.not.toThrow();
        });

        test('should pass for number with country code', async () => {
            await expect(
                Validators.phone({ country: 'KE' })('+254712345678')
            ).resolves.not.toThrow();
        });

        test('should throw for invalid number', async () => {
            await expect(Validators.phone()('123')).rejects.toThrow(ValidationError);
        });
    });

    describe('Validators.email', () => {
        test('should pass for valid email', async () => {
            await expect(Validators.email()('test@example.com')).resolves.not.toThrow();
        });

        test('should throw for invalid email', async () => {
            await expect(Validators.email()('notanemail')).rejects.toThrow(ValidationError);
        });

        test('should throw for missing @', async () => {
            await expect(Validators.email()('testexample.com')).rejects.toThrow(ValidationError);
        });
    });

    describe('Validators.age', () => {
        test('should pass for valid age', async () => {
            await expect(Validators.age()('25')).resolves.not.toThrow();
        });

        test('should throw for age below minimum', async () => {
            await expect(
                Validators.age({ min: 18 })('15')
            ).rejects.toThrow(ValidationError);
        });

        test('should throw for age above maximum', async () => {
            await expect(
                Validators.age({ max: 100 })('150')
            ).rejects.toThrow(ValidationError);
        });

        test('should throw for non-numeric age', async () => {
            await expect(Validators.age()('twenty')).rejects.toThrow(ValidationError);
        });
    });

    describe('Validators.pin', () => {
        test('should pass for valid 4-digit PIN', async () => {
            await expect(Validators.pin()('1234')).resolves.not.toThrow();
        });

        test('should throw for non-numeric PIN', async () => {
            await expect(Validators.pin()('12ab')).rejects.toThrow(ValidationError);
        });

        test('should throw for wrong length', async () => {
            await expect(Validators.pin()('123')).rejects.toThrow(ValidationError);
        });

        test('should validate custom length', async () => {
            await expect(Validators.pin({ length: 6 })('123456')).resolves.not.toThrow();
        });
    });

    describe('Validators.amount', () => {
        test('should pass for valid amount', async () => {
            await expect(Validators.amount()('100.50')).resolves.not.toThrow();
        });

        test('should pass for amount with currency symbol', async () => {
            await expect(Validators.amount()('$100')).resolves.not.toThrow();
        });

        test('should throw for negative amount', async () => {
            await expect(Validators.amount()('-50')).rejects.toThrow(ValidationError);
        });

        test('should validate minimum amount', async () => {
            await expect(
                Validators.amount({ min: 100 })('50')
            ).rejects.toThrow(ValidationError);
        });

        test('should validate maximum amount', async () => {
            await expect(
                Validators.amount({ max: 1000 })('5000')
            ).rejects.toThrow(ValidationError);
        });
    });

    describe('Validators.oneOf', () => {
        test('should pass for allowed value', async () => {
            await expect(Validators.oneOf(['1', '2', '3'])('2')).resolves.not.toThrow();
        });

        test('should throw for disallowed value', async () => {
            await expect(
                Validators.oneOf(['1', '2', '3'])('5')
            ).rejects.toThrow(ValidationError);
        });
    });

    describe('Validators.menuOption', () => {
        test('should pass for valid option', async () => {
            await expect(Validators.menuOption({ max: 5 })('3')).resolves.not.toThrow();
        });

        test('should throw for option out of range', async () => {
            await expect(
                Validators.menuOption({ max: 5 })('7')
            ).rejects.toThrow(ValidationError);
        });

        test('should validate specific allowed options', async () => {
            await expect(
                Validators.menuOption({ allowed: ['1', '2', '0'] })('0')
            ).resolves.not.toThrow();
        });
    });

    describe('createValidator', () => {
        test('should combine multiple rules', async () => {
            const validator = createValidator({
                required: true,
                minLength: 3,
                maxLength: 10
            });

            await expect(validator('hello')).resolves.not.toThrow();
            await expect(validator('')).rejects.toThrow(ValidationError);
            await expect(validator('hi')).rejects.toThrow(ValidationError);
        });
    });

    describe('combineValidators', () => {
        test('should run all validators in sequence', async () => {
            const combined = combineValidators(
                Validators.required(),
                Validators.minLength(3)
            );

            await expect(combined('hello')).resolves.not.toThrow();
            await expect(combined('')).rejects.toThrow(ValidationError);
        });
    });

    describe('optional', () => {
        test('should skip validation for empty input', async () => {
            const optionalNumeric = optional(Validators.numeric());
            await expect(optionalNumeric('')).resolves.not.toThrow();
        });

        test('should validate non-empty input', async () => {
            const optionalNumeric = optional(Validators.numeric());
            await expect(optionalNumeric('abc')).rejects.toThrow(ValidationError);
        });

        test('should skip validation for whitespace-only input', async () => {
            const optionalPhone = optional(Validators.phone({ country: 'KE' }));
            await expect(optionalPhone('   ')).resolves.not.toThrow();
        });

        test('should skip validation for null input', async () => {
            const optionalEmail = optional(Validators.email());
            await expect(optionalEmail(null)).resolves.not.toThrow();
        });

        test('should skip validation for undefined input', async () => {
            const optionalEmail = optional(Validators.email());
            await expect(optionalEmail(undefined)).resolves.not.toThrow();
        });

        test('should validate valid non-empty input and pass', async () => {
            const optionalNumeric = optional(Validators.numeric());
            await expect(optionalNumeric('42')).resolves.not.toThrow();
        });
    });

    describe('Validators.date - edge cases', () => {
        test('should pass for valid YYYY-MM-DD date', async () => {
            await expect(Validators.date()('2024-01-15')).resolves.not.toThrow();
        });

        test('should throw for invalid YYYY-MM-DD format', async () => {
            await expect(Validators.date()('01-15-2024')).rejects.toThrow(ValidationError);
        });

        test('should throw for completely invalid date string', async () => {
            await expect(Validators.date()('not-a-date')).rejects.toThrow(ValidationError);
        });

        test('should skip validation for empty input', async () => {
            await expect(Validators.date()('')).resolves.not.toThrow();
        });

        test('should skip validation for whitespace-only input', async () => {
            await expect(Validators.date()('   ')).resolves.not.toThrow();
        });

        test('should pass DD-MM-YYYY regex for valid format with parseable date', async () => {
            // Day <= 12 so Date constructor can parse it (interprets as MM-DD-YYYY)
            await expect(
                Validators.date({ format: 'DD-MM-YYYY' })('01-05-2024')
            ).resolves.not.toThrow();
        });

        test('should throw for DD-MM-YYYY when day > 12 because Date cannot parse it', async () => {
            // Passes regex but new Date('15-01-2024') is invalid
            await expect(
                Validators.date({ format: 'DD-MM-YYYY' })('15-01-2024')
            ).rejects.toThrow(ValidationError);
        });

        test('should throw for wrong separator in DD-MM-YYYY format', async () => {
            await expect(
                Validators.date({ format: 'DD-MM-YYYY' })('15/01/2024')
            ).rejects.toThrow(ValidationError);
        });

        test('should pass DD/MM/YYYY regex for valid format with parseable date', async () => {
            // Day <= 12 so Date constructor can parse it
            await expect(
                Validators.date({ format: 'DD/MM/YYYY' })('01/05/2024')
            ).resolves.not.toThrow();
        });

        test('should throw for DD/MM/YYYY when day > 12 because Date cannot parse it', async () => {
            // Passes regex but new Date('15/01/2024') is invalid
            await expect(
                Validators.date({ format: 'DD/MM/YYYY' })('15/01/2024')
            ).rejects.toThrow(ValidationError);
        });

        test('should throw for invalid DD/MM/YYYY format with dashes', async () => {
            await expect(
                Validators.date({ format: 'DD/MM/YYYY' })('15-01-2024')
            ).rejects.toThrow(ValidationError);
        });

        test('should validate MM-DD-YYYY format', async () => {
            await expect(
                Validators.date({ format: 'MM-DD-YYYY' })('01-15-2024')
            ).resolves.not.toThrow();
        });

        test('should validate MM/DD/YYYY format', async () => {
            await expect(
                Validators.date({ format: 'MM/DD/YYYY' })('01/15/2024')
            ).resolves.not.toThrow();
        });

        test('should use custom error message', async () => {
            await expect(
                Validators.date({ message: 'Bad date!' })('xyz')
            ).rejects.toThrow('Bad date!');
        });

        test('should throw for date with correct format but invalid values', async () => {
            await expect(Validators.date()('2024-13-45')).rejects.toThrow(ValidationError);
        });

        test('should handle unknown format gracefully by skipping pattern check', async () => {
            // An unknown format has no regex pattern, so only the Date parsing check applies
            await expect(
                Validators.date({ format: 'YYYY/MM/DD' })('2024/01/15')
            ).resolves.not.toThrow();
        });

        test('should throw for unknown format with unparseable date', async () => {
            await expect(
                Validators.date({ format: 'YYYY/MM/DD' })('garbage')
            ).rejects.toThrow(ValidationError);
        });
    });

    describe('Validators.pattern - edge cases', () => {
        test('should pass when input matches RegExp directly', async () => {
            await expect(
                Validators.pattern(/^[A-Z]+$/)('HELLO')
            ).resolves.not.toThrow();
        });

        test('should throw when input does not match RegExp directly', async () => {
            await expect(
                Validators.pattern(/^[A-Z]+$/)('hello')
            ).rejects.toThrow('Invalid format');
        });

        test('should use custom message from options object', async () => {
            await expect(
                Validators.pattern({ pattern: /^\d+$/, message: 'Numbers only please' })('abc')
            ).rejects.toThrow('Numbers only please');
        });

        test('should pass for matching pattern with options object', async () => {
            await expect(
                Validators.pattern({ pattern: /^\d{3}$/ })('123')
            ).resolves.not.toThrow();
        });

        test('should skip validation for empty input', async () => {
            await expect(
                Validators.pattern(/^\d+$/)('')
            ).resolves.not.toThrow();
        });

        test('should skip validation for null input', async () => {
            await expect(
                Validators.pattern(/^\d+$/)(null)
            ).resolves.not.toThrow();
        });

        test('should skip validation for undefined input', async () => {
            await expect(
                Validators.pattern(/^\d+$/)(undefined)
            ).resolves.not.toThrow();
        });

        test('should use default message when options is RegExp', async () => {
            await expect(
                Validators.pattern(/^[0-9]$/)('abc')
            ).rejects.toThrow('Invalid format');
        });
    });

    describe('Validators.idNumber - country formats', () => {
        test('should pass for valid generic ID', async () => {
            await expect(
                Validators.idNumber()('ABC12345')
            ).resolves.not.toThrow();
        });

        test('should throw for generic ID with special characters', async () => {
            await expect(
                Validators.idNumber()('AB-123!')
            ).rejects.toThrow(ValidationError);
        });

        test('should pass for valid Kenyan ID (7 digits)', async () => {
            await expect(
                Validators.idNumber({ type: 'kenyanId' })('1234567')
            ).resolves.not.toThrow();
        });

        test('should pass for valid Kenyan ID (8 digits)', async () => {
            await expect(
                Validators.idNumber({ type: 'kenyanId' })('12345678')
            ).resolves.not.toThrow();
        });

        test('should throw for Kenyan ID with letters', async () => {
            await expect(
                Validators.idNumber({ type: 'kenyanId' })('1234ABC')
            ).rejects.toThrow(ValidationError);
        });

        test('should throw for Kenyan ID too short (6 digits)', async () => {
            await expect(
                Validators.idNumber({ type: 'kenyanId' })('123456')
            ).rejects.toThrow(ValidationError);
        });

        test('should throw for Kenyan ID too long (9 digits)', async () => {
            await expect(
                Validators.idNumber({ type: 'kenyanId' })('123456789')
            ).rejects.toThrow(ValidationError);
        });

        test('should pass for valid passport number', async () => {
            await expect(
                Validators.idNumber({ type: 'passport' })('A1234567')
            ).resolves.not.toThrow();
        });

        test('should pass for passport with two-letter prefix', async () => {
            await expect(
                Validators.idNumber({ type: 'passport' })('AB123456')
            ).resolves.not.toThrow();
        });

        test('should throw for passport with no letter prefix', async () => {
            await expect(
                Validators.idNumber({ type: 'passport' })('12345678')
            ).rejects.toThrow(ValidationError);
        });

        test('should throw for passport with too few digits', async () => {
            await expect(
                Validators.idNumber({ type: 'passport' })('A12345')
            ).rejects.toThrow(ValidationError);
        });

        test('should use custom error message', async () => {
            await expect(
                Validators.idNumber({ type: 'kenyanId', message: 'Invalid national ID' })('abc')
            ).rejects.toThrow('Invalid national ID');
        });

        test('should skip validation for empty input', async () => {
            await expect(Validators.idNumber()('')).resolves.not.toThrow();
        });

        test('should skip validation for whitespace-only input', async () => {
            await expect(Validators.idNumber()('   ')).resolves.not.toThrow();
        });

        test('should fall back to generic pattern for unknown type', async () => {
            await expect(
                Validators.idNumber({ type: 'unknownType' })('ABC123')
            ).resolves.not.toThrow();
        });

        test('should throw for generic ID that is too short', async () => {
            await expect(
                Validators.idNumber()('AB')
            ).rejects.toThrow(ValidationError);
        });

        test('should throw for generic ID that is too long', async () => {
            await expect(
                Validators.idNumber()('A'.repeat(21))
            ).rejects.toThrow(ValidationError);
        });
    });

    describe('when - conditional validator', () => {
        test('should apply validator when condition is true', async () => {
            const conditionalRequired = when(
                (input) => input !== undefined,
                Validators.required()
            );
            await expect(conditionalRequired('')).rejects.toThrow(ValidationError);
        });

        test('should skip validator when condition is false', async () => {
            const conditionalRequired = when(
                () => false,
                Validators.required()
            );
            await expect(conditionalRequired('')).resolves.not.toThrow();
        });

        test('should pass context to condition function', async () => {
            const conditionalValidator = when(
                (input, context) => context && context.requireValidation === true,
                Validators.numeric()
            );
            // When context says to validate, non-numeric should fail
            await expect(conditionalValidator('abc', { requireValidation: true }))
                .rejects.toThrow(ValidationError);
        });

        test('should skip validation when context condition is false', async () => {
            const conditionalValidator = when(
                (input, context) => context && context.requireValidation === true,
                Validators.numeric()
            );
            // When context says not to validate, non-numeric should pass
            await expect(conditionalValidator('abc', { requireValidation: false }))
                .resolves.not.toThrow();
        });

        test('should work with async condition function', async () => {
            const asyncCondition = when(
                async () => true,
                Validators.minLength(5)
            );
            await expect(asyncCondition('hi')).rejects.toThrow(ValidationError);
        });

        test('should pass when condition is true and input is valid', async () => {
            const conditionalNumeric = when(
                () => true,
                Validators.numeric()
            );
            await expect(conditionalNumeric('42')).resolves.not.toThrow();
        });

        test('should work with input-based condition', async () => {
            const conditionalValidator = when(
                (input) => input && input.startsWith('+'),
                Validators.phone({ country: 'KE' })
            );
            // Input starts with +, so phone validation applies
            await expect(conditionalValidator('+254712345678'))
                .resolves.not.toThrow();
            // Input does not start with +, so validation is skipped
            await expect(conditionalValidator('not-a-phone'))
                .resolves.not.toThrow();
        });
    });

    describe('Validators.password', () => {
        test('should pass for a strong password with defaults', async () => {
            await expect(Validators.password()('Abcdef1!')).resolves.not.toThrow();
        });

        test('should throw for password too short', async () => {
            await expect(Validators.password()('Ab1')).rejects.toThrow(
                'Password must be at least 8 characters'
            );
        });

        test('should throw for password missing uppercase', async () => {
            await expect(Validators.password()('abcdefg1')).rejects.toThrow(
                'Password must contain at least one uppercase letter'
            );
        });

        test('should throw for password missing lowercase', async () => {
            await expect(Validators.password()('ABCDEFG1')).rejects.toThrow(
                'Password must contain at least one lowercase letter'
            );
        });

        test('should throw for password missing number', async () => {
            await expect(Validators.password()('Abcdefgh')).rejects.toThrow(
                'Password must contain at least one number'
            );
        });

        test('should throw for password missing special character when required', async () => {
            await expect(
                Validators.password({ requireSpecial: true })('Abcdefg1')
            ).rejects.toThrow('Password must contain at least one special character');
        });

        test('should pass when special character is present and required', async () => {
            await expect(
                Validators.password({ requireSpecial: true })('Abcdef1!')
            ).resolves.not.toThrow();
        });

        test('should allow custom minimum length', async () => {
            await expect(
                Validators.password({ minLength: 12 })('Abcdefg1')
            ).rejects.toThrow('Password must be at least 12 characters');
        });

        test('should pass for custom minimum length when long enough', async () => {
            await expect(
                Validators.password({ minLength: 4 })('Ab1d')
            ).resolves.not.toThrow();
        });

        test('should allow disabling uppercase requirement', async () => {
            await expect(
                Validators.password({ requireUppercase: false })('abcdefg1')
            ).resolves.not.toThrow();
        });

        test('should allow disabling lowercase requirement', async () => {
            await expect(
                Validators.password({ requireLowercase: false })('ABCDEFG1')
            ).resolves.not.toThrow();
        });

        test('should allow disabling number requirement', async () => {
            await expect(
                Validators.password({ requireNumber: false })('Abcdefgh')
            ).resolves.not.toThrow();
        });

        test('should use custom error message for all failures', async () => {
            await expect(
                Validators.password({ message: 'Weak password' })('short')
            ).rejects.toThrow('Weak password');
        });

        test('should skip validation for empty input', async () => {
            await expect(Validators.password()('')).resolves.not.toThrow();
        });

        test('should skip validation for whitespace-only input', async () => {
            await expect(Validators.password()('   ')).resolves.not.toThrow();
        });
    });

    describe('Validators.alphanumeric', () => {
        test('should pass for letters only', async () => {
            await expect(Validators.alphanumeric()('Hello')).resolves.not.toThrow();
        });

        test('should pass for numbers only', async () => {
            await expect(Validators.alphanumeric()('12345')).resolves.not.toThrow();
        });

        test('should pass for mixed letters and numbers', async () => {
            await expect(Validators.alphanumeric()('abc123')).resolves.not.toThrow();
        });

        test('should throw for input with spaces', async () => {
            await expect(Validators.alphanumeric()('hello world')).rejects.toThrow(ValidationError);
        });

        test('should throw for input with special characters', async () => {
            await expect(Validators.alphanumeric()('hello!')).rejects.toThrow(ValidationError);
        });

        test('should throw for input with hyphens', async () => {
            await expect(Validators.alphanumeric()('hello-world')).rejects.toThrow(ValidationError);
        });

        test('should use custom message as string', async () => {
            await expect(
                Validators.alphanumeric('Letters and numbers only')('abc!')
            ).rejects.toThrow('Letters and numbers only');
        });

        test('should use custom message from options object', async () => {
            await expect(
                Validators.alphanumeric({ message: 'No specials!' })('abc!')
            ).rejects.toThrow('No specials!');
        });

        test('should skip validation for empty input', async () => {
            await expect(Validators.alphanumeric()('')).resolves.not.toThrow();
        });

        test('should skip validation for null input', async () => {
            await expect(Validators.alphanumeric()(null)).resolves.not.toThrow();
        });
    });

    describe('Validators.url', () => {
        test('should pass for valid http URL', async () => {
            await expect(Validators.url()('http://example.com')).resolves.not.toThrow();
        });

        test('should pass for valid https URL', async () => {
            await expect(Validators.url()('https://example.com')).resolves.not.toThrow();
        });

        test('should pass for URL with path', async () => {
            await expect(Validators.url()('https://example.com/path/to/page')).resolves.not.toThrow();
        });

        test('should pass for URL with query string', async () => {
            await expect(Validators.url()('https://example.com?key=value')).resolves.not.toThrow();
        });

        test('should pass for URL with fragment', async () => {
            await expect(Validators.url()('https://example.com#section')).resolves.not.toThrow();
        });

        test('should throw for URL without protocol', async () => {
            await expect(Validators.url()('example.com')).rejects.toThrow(ValidationError);
        });

        test('should throw for ftp URL', async () => {
            await expect(Validators.url()('ftp://files.example.com')).rejects.toThrow(ValidationError);
        });

        test('should throw for random string', async () => {
            await expect(Validators.url()('not a url')).rejects.toThrow(ValidationError);
        });

        test('should use custom message as string', async () => {
            await expect(
                Validators.url('Please enter a valid URL')('bad')
            ).rejects.toThrow('Please enter a valid URL');
        });

        test('should use custom message from options object', async () => {
            await expect(
                Validators.url({ message: 'Bad URL!' })('bad')
            ).rejects.toThrow('Bad URL!');
        });

        test('should skip validation for empty input', async () => {
            await expect(Validators.url()('')).resolves.not.toThrow();
        });

        test('should skip validation for null input', async () => {
            await expect(Validators.url()(null)).resolves.not.toThrow();
        });
    });

    describe('Validators.ipAddress', () => {
        test('should pass for valid IP address', async () => {
            await expect(Validators.ipAddress()('192.168.1.1')).resolves.not.toThrow();
        });

        test('should pass for 0.0.0.0', async () => {
            await expect(Validators.ipAddress()('0.0.0.0')).resolves.not.toThrow();
        });

        test('should pass for 255.255.255.255', async () => {
            await expect(Validators.ipAddress()('255.255.255.255')).resolves.not.toThrow();
        });

        test('should pass for localhost 127.0.0.1', async () => {
            await expect(Validators.ipAddress()('127.0.0.1')).resolves.not.toThrow();
        });

        test('should throw for IP with octet > 255', async () => {
            await expect(Validators.ipAddress()('256.1.1.1')).rejects.toThrow(ValidationError);
        });

        test('should throw for IP with too few octets', async () => {
            await expect(Validators.ipAddress()('192.168.1')).rejects.toThrow(ValidationError);
        });

        test('should throw for IP with too many octets', async () => {
            await expect(Validators.ipAddress()('192.168.1.1.1')).rejects.toThrow(ValidationError);
        });

        test('should throw for IP with non-numeric octets', async () => {
            await expect(Validators.ipAddress()('abc.def.ghi.jkl')).rejects.toThrow(ValidationError);
        });

        test('should throw for random string', async () => {
            await expect(Validators.ipAddress()('not-an-ip')).rejects.toThrow(ValidationError);
        });

        test('should throw for IP with negative octet', async () => {
            await expect(Validators.ipAddress()('-1.0.0.0')).rejects.toThrow(ValidationError);
        });

        test('should use custom message as string', async () => {
            await expect(
                Validators.ipAddress('Not a valid IP')('bad')
            ).rejects.toThrow('Not a valid IP');
        });

        test('should use custom message from options object', async () => {
            await expect(
                Validators.ipAddress({ message: 'Invalid!' })('bad')
            ).rejects.toThrow('Invalid!');
        });

        test('should skip validation for empty input', async () => {
            await expect(Validators.ipAddress()('')).resolves.not.toThrow();
        });

        test('should skip validation for null input', async () => {
            await expect(Validators.ipAddress()(null)).resolves.not.toThrow();
        });

        test('should skip validation for whitespace-only input', async () => {
            await expect(Validators.ipAddress()('   ')).resolves.not.toThrow();
        });
    });

    describe('combineValidators - mixed passing and failing', () => {
        test('should fail on first failing validator in sequence', async () => {
            const combined = combineValidators(
                Validators.required(),
                Validators.numeric(),
                Validators.numeric({ min: 10 })
            );
            // Empty input fails at required (first validator)
            await expect(combined('')).rejects.toThrow('This field is required');
        });

        test('should fail on second validator if first passes', async () => {
            const combined = combineValidators(
                Validators.required(),
                Validators.numeric(),
                Validators.numeric({ min: 10 })
            );
            // Non-numeric fails at numeric (second validator)
            await expect(combined('abc')).rejects.toThrow('Must be a valid number');
        });

        test('should fail on third validator if first two pass', async () => {
            const combined = combineValidators(
                Validators.required(),
                Validators.numeric(),
                Validators.numeric({ min: 10 })
            );
            // Number below min fails at min check (third validator)
            await expect(combined('5')).rejects.toThrow('Must be at least 10');
        });

        test('should pass when all validators pass', async () => {
            const combined = combineValidators(
                Validators.required(),
                Validators.numeric(),
                Validators.numeric({ min: 10, max: 100 })
            );
            await expect(combined('50')).resolves.not.toThrow();
        });

        test('should combine validators of different types', async () => {
            const combined = combineValidators(
                Validators.required(),
                Validators.minLength(3),
                Validators.maxLength(10),
                Validators.alphanumeric()
            );
            // Valid input passes all
            await expect(combined('Hello123')).resolves.not.toThrow();
            // Too short
            await expect(combined('Hi')).rejects.toThrow(ValidationError);
            // Too long
            await expect(combined('ThisIsWayTooLong')).rejects.toThrow(ValidationError);
            // Has special characters
            await expect(combined('Hello!')).rejects.toThrow(ValidationError);
        });

        test('should work with single validator', async () => {
            const combined = combineValidators(Validators.required());
            await expect(combined('hello')).resolves.not.toThrow();
            await expect(combined('')).rejects.toThrow(ValidationError);
        });

        test('should work with no validators', async () => {
            const combined = combineValidators();
            await expect(combined('anything')).resolves.not.toThrow();
        });
    });

    describe('Validators.required - additional edge cases', () => {
        test('should throw for null input', async () => {
            await expect(Validators.required()(null)).rejects.toThrow(ValidationError);
        });

        test('should throw for undefined input', async () => {
            await expect(Validators.required()(undefined)).rejects.toThrow(ValidationError);
        });

        test('should use default message when boolean true is passed', async () => {
            await expect(Validators.required(true)('')).rejects.toThrow('This field is required');
        });
    });

    describe('Validators.exactLength - edge cases', () => {
        test('should pass for input with exact length', async () => {
            await expect(Validators.exactLength(5)('hello')).resolves.not.toThrow();
        });

        test('should throw for input shorter than exact length', async () => {
            await expect(Validators.exactLength(5)('hi')).rejects.toThrow(ValidationError);
        });

        test('should throw for input longer than exact length', async () => {
            await expect(Validators.exactLength(3)('hello')).rejects.toThrow(ValidationError);
        });

        test('should use custom message from options object', async () => {
            await expect(
                Validators.exactLength({ length: 4, message: 'Must be 4 chars' })('hi')
            ).rejects.toThrow('Must be 4 chars');
        });

        test('should skip validation for empty/null input', async () => {
            await expect(Validators.exactLength(5)('')).resolves.not.toThrow();
        });
    });

    describe('Validators.maxLength - edge cases', () => {
        test('should use custom message from options object', async () => {
            await expect(
                Validators.maxLength({ length: 3, message: 'Too long!' })('hello')
            ).rejects.toThrow('Too long!');
        });

        test('should pass for input exactly at maximum', async () => {
            await expect(Validators.maxLength(5)('hello')).resolves.not.toThrow();
        });
    });

    describe('Validators.numeric - additional edge cases', () => {
        test('should skip validation for empty string', async () => {
            await expect(Validators.numeric()('')).resolves.not.toThrow();
        });

        test('should skip validation for null', async () => {
            await expect(Validators.numeric()(null)).resolves.not.toThrow();
        });

        test('should skip validation for undefined', async () => {
            await expect(Validators.numeric()(undefined)).resolves.not.toThrow();
        });

        test('should use custom message as string option', async () => {
            await expect(Validators.numeric('Enter a number')('abc'))
                .rejects.toThrow('Enter a number');
        });

        test('should use custom integer message', async () => {
            await expect(
                Validators.numeric({ integer: true, integerMessage: 'Whole numbers only' })('3.5')
            ).rejects.toThrow('Whole numbers only');
        });

        test('should use custom min message', async () => {
            await expect(
                Validators.numeric({ min: 10, minMessage: 'Too small' })('5')
            ).rejects.toThrow('Too small');
        });

        test('should use custom max message', async () => {
            await expect(
                Validators.numeric({ max: 10, maxMessage: 'Too large' })('15')
            ).rejects.toThrow('Too large');
        });

        test('should pass for negative numbers', async () => {
            await expect(Validators.numeric()('-5')).resolves.not.toThrow();
        });

        test('should pass integer check for whole number', async () => {
            await expect(
                Validators.numeric({ integer: true })('42')
            ).resolves.not.toThrow();
        });
    });

    describe('Validators.phone - additional edge cases', () => {
        test('should skip validation for empty input', async () => {
            await expect(Validators.phone()('')).resolves.not.toThrow();
        });

        test('should skip validation for whitespace-only input', async () => {
            await expect(Validators.phone()('   ')).resolves.not.toThrow();
        });

        test('should strip formatting characters before validation', async () => {
            await expect(
                Validators.phone()('+1 (234) 567-8901')
            ).resolves.not.toThrow();
        });

        test('should use custom error message', async () => {
            await expect(
                Validators.phone({ message: 'Bad phone' })('123')
            ).rejects.toThrow('Bad phone');
        });

        test('should validate Nigerian number', async () => {
            await expect(
                Validators.phone({ country: 'NG' })('08012345678')
            ).resolves.not.toThrow();
        });

        test('should validate South African number', async () => {
            await expect(
                Validators.phone({ country: 'ZA' })('0612345678')
            ).resolves.not.toThrow();
        });

        test('should validate Ghanaian number', async () => {
            await expect(
                Validators.phone({ country: 'GH' })('0201234567')
            ).resolves.not.toThrow();
        });

        test('should validate Tanzanian number', async () => {
            await expect(
                Validators.phone({ country: 'TZ' })('0612345678')
            ).resolves.not.toThrow();
        });

        test('should validate Ugandan number', async () => {
            await expect(
                Validators.phone({ country: 'UG' })('0712345678')
            ).resolves.not.toThrow();
        });
    });

    describe('Validators.email - additional edge cases', () => {
        test('should skip validation for empty input', async () => {
            await expect(Validators.email()('')).resolves.not.toThrow();
        });

        test('should skip validation for whitespace-only input', async () => {
            await expect(Validators.email()('   ')).resolves.not.toThrow();
        });

        test('should use custom message as string', async () => {
            await expect(
                Validators.email('Bad email')('notvalid')
            ).rejects.toThrow('Bad email');
        });

        test('should use custom message from options object', async () => {
            await expect(
                Validators.email({ message: 'Invalid!' })('notvalid')
            ).rejects.toThrow('Invalid!');
        });
    });

    describe('Validators.amount - additional edge cases', () => {
        test('should throw for non-numeric amount', async () => {
            await expect(Validators.amount()('abc')).rejects.toThrow('Invalid amount');
        });

        test('should throw for too many decimal places', async () => {
            await expect(Validators.amount()('10.123')).rejects.toThrow(
                'Maximum 2 decimal places allowed'
            );
        });

        test('should allow custom decimal places', async () => {
            await expect(
                Validators.amount({ decimals: 4 })('10.1234')
            ).resolves.not.toThrow();
        });

        test('should throw when exceeding custom decimal places', async () => {
            await expect(
                Validators.amount({ decimals: 1 })('10.12')
            ).rejects.toThrow('Maximum 1 decimal places allowed');
        });

        test('should skip validation for empty input', async () => {
            await expect(Validators.amount()('')).resolves.not.toThrow();
        });

        test('should handle amounts with various currency symbols', async () => {
            await expect(Validators.amount()('£100')).resolves.not.toThrow();
            await expect(Validators.amount()('€50')).resolves.not.toThrow();
            await expect(Validators.amount()('₦1000')).resolves.not.toThrow();
        });
    });

    describe('Validators.oneOf - additional edge cases', () => {
        test('should skip validation for empty input', async () => {
            await expect(Validators.oneOf(['a', 'b'])('')).resolves.not.toThrow();
        });

        test('should use custom message from options object', async () => {
            await expect(
                Validators.oneOf({ values: ['a', 'b'], message: 'Pick a or b' })('c')
            ).rejects.toThrow('Pick a or b');
        });

        test('should pass when value matches in options object', async () => {
            await expect(
                Validators.oneOf({ values: ['x', 'y', 'z'] })('y')
            ).resolves.not.toThrow();
        });
    });

    describe('Validators.menuOption - additional edge cases', () => {
        test('should skip validation for empty input', async () => {
            await expect(Validators.menuOption()('')).resolves.not.toThrow();
        });

        test('should throw for non-numeric input', async () => {
            await expect(Validators.menuOption()('abc')).rejects.toThrow('Invalid option');
        });

        test('should throw for option below min', async () => {
            await expect(
                Validators.menuOption({ min: 2 })('1')
            ).rejects.toThrow('Invalid option');
        });

        test('should throw for disallowed option in allowed list', async () => {
            await expect(
                Validators.menuOption({ allowed: ['1', '2'] })('3')
            ).rejects.toThrow('Invalid option');
        });

        test('should use custom error message', async () => {
            await expect(
                Validators.menuOption({ max: 3, message: 'Choose 1-3' })('5')
            ).rejects.toThrow('Choose 1-3');
        });
    });

    describe('Validators.age - additional edge cases', () => {
        test('should skip validation for empty input', async () => {
            await expect(Validators.age()('')).resolves.not.toThrow();
        });

        test('should use custom error message', async () => {
            await expect(
                Validators.age({ min: 18, message: 'Must be 18+' })('15')
            ).rejects.toThrow('Must be 18+');
        });

        test('should pass for age at exact boundary', async () => {
            await expect(Validators.age({ min: 18, max: 65 })('18')).resolves.not.toThrow();
            await expect(Validators.age({ min: 18, max: 65 })('65')).resolves.not.toThrow();
        });
    });

    describe('Validators.pin - additional edge cases', () => {
        test('should skip validation for empty input', async () => {
            await expect(Validators.pin()('')).resolves.not.toThrow();
        });

        test('should allow non-numeric PIN when numericOnly is false', async () => {
            await expect(
                Validators.pin({ numericOnly: false, length: 4 })('Ab1!')
            ).resolves.not.toThrow();
        });

        test('should use custom error message', async () => {
            await expect(
                Validators.pin({ message: 'Bad PIN' })('abc')
            ).rejects.toThrow('Bad PIN');
        });
    });

    describe('Validators.custom', () => {
        test('should pass when custom function does not throw', async () => {
            const customValidator = Validators.custom(async (input) => {
                // no-op means valid
            });
            await expect(customValidator('anything')).resolves.not.toThrow();
        });

        test('should throw when custom function throws ValidationError', async () => {
            const customValidator = Validators.custom(async (input) => {
                if (input !== 'secret') {
                    throw new ValidationError('Wrong answer');
                }
            });
            await expect(customValidator('wrong')).rejects.toThrow('Wrong answer');
            await expect(customValidator('secret')).resolves.not.toThrow();
        });
    });

    describe('createValidator - additional cases', () => {
        test('should skip unknown rules gracefully', async () => {
            const validator = createValidator({
                unknownRule: true
            });
            // Unknown rules are silently ignored (no matching validator)
            await expect(validator('anything')).resolves.not.toThrow();
        });

        test('should work with numeric rule options', async () => {
            const validator = createValidator({
                numeric: { min: 1, max: 100 }
            });
            await expect(validator('50')).resolves.not.toThrow();
            await expect(validator('abc')).rejects.toThrow(ValidationError);
        });
    });
});
