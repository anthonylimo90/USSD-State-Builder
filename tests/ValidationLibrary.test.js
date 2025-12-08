const {
    Validators,
    createValidator,
    combineValidators,
    optional
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
    });
});
