const {
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
} = require('../lib/Errors');

describe('Custom Error Types', () => {
    describe('USSDError (base class)', () => {
        test('should create error with message and code', () => {
            const error = new USSDError('Test error', 'TEST_CODE');

            expect(error.message).toBe('Test error');
            expect(error.code).toBe('TEST_CODE');
            expect(error.name).toBe('USSDError');
            expect(error.timestamp).toBeDefined();
        });

        test('should include context', () => {
            const error = new USSDError('Error', 'CODE', { extra: 'data' });
            expect(error.context.extra).toBe('data');
        });

        test('should convert to JSON', () => {
            const error = new USSDError('Test', 'CODE');
            const json = error.toJSON();

            expect(json.name).toBe('USSDError');
            expect(json.message).toBe('Test');
            expect(json.code).toBe('CODE');
        });
    });

    describe('ValidationError', () => {
        test('should create with field and value', () => {
            const error = new ValidationError('Invalid input', 'email', 'notanemail');

            expect(error.name).toBe('ValidationError');
            expect(error.code).toBe('VALIDATION_ERROR');
            expect(error.field).toBe('email');
            expect(error.value).toBe('notanemail');
        });
    });

    describe('StateNotFoundError', () => {
        test('should include state name', () => {
            const error = new StateNotFoundError('MISSING_STATE', 'CURRENT');

            expect(error.name).toBe('StateNotFoundError');
            expect(error.code).toBe('STATE_NOT_FOUND');
            expect(error.stateName).toBe('MISSING_STATE');
            expect(error.fromState).toBe('CURRENT');
            expect(error.message).toContain('MISSING_STATE');
        });
    });

    describe('SessionNotFoundError', () => {
        test('should include session ID', () => {
            const error = new SessionNotFoundError('session123');

            expect(error.name).toBe('SessionNotFoundError');
            expect(error.sessionId).toBe('session123');
        });
    });

    describe('SessionExpiredError', () => {
        test('should include expiration time', () => {
            const expiredAt = new Date();
            const error = new SessionExpiredError('session123', expiredAt);

            expect(error.name).toBe('SessionExpiredError');
            expect(error.code).toBe('SESSION_EXPIRED');
            expect(error.sessionId).toBe('session123');
            expect(error.expiredAt).toBe(expiredAt);
        });
    });

    describe('StorageError', () => {
        test('should include operation and original error', () => {
            const original = new Error('Connection failed');
            const error = new StorageError('Storage failed', 'get', original);

            expect(error.name).toBe('StorageError');
            expect(error.operation).toBe('get');
            expect(error.originalError).toBe(original);
        });
    });

    describe('ConfigurationError', () => {
        test('should include property and value', () => {
            const error = new ConfigurationError('Invalid timeout', 'timeout', -1);

            expect(error.name).toBe('ConfigurationError');
            expect(error.property).toBe('timeout');
            expect(error.invalidValue).toBe(-1);
        });
    });

    describe('HandlerError', () => {
        test('should include state and original error', () => {
            const original = new Error('Handler crashed');
            const error = new HandlerError('Handler failed', 'MENU', original);

            expect(error.name).toBe('HandlerError');
            expect(error.state).toBe('MENU');
            expect(error.originalError).toBe(original);
        });
    });

    describe('TimeoutError', () => {
        test('should include timeout duration', () => {
            const error = new TimeoutError('Operation timed out', 5000, 'database');

            expect(error.name).toBe('TimeoutError');
            expect(error.timeout).toBe(5000);
            expect(error.operation).toBe('database');
        });
    });

    describe('RateLimitError', () => {
        test('should include limit and retry after', () => {
            const error = new RateLimitError('Too many requests', 10, 30);

            expect(error.name).toBe('RateLimitError');
            expect(error.limit).toBe(10);
            expect(error.retryAfter).toBe(30);
        });
    });

    describe('NavigationError', () => {
        test('should include direction and current state', () => {
            const error = new NavigationError('Cannot go back', 'back', 'WELCOME');

            expect(error.name).toBe('NavigationError');
            expect(error.direction).toBe('back');
            expect(error.currentState).toBe('WELCOME');
        });
    });
});

describe('ErrorHandler', () => {
    describe('wrap', () => {
        test('should return result on success', async () => {
            const fn = async () => 'success';
            const wrapped = ErrorHandler.wrap(fn);

            expect(await wrapped()).toBe('success');
        });

        test('should call error handler on failure', async () => {
            const fn = async () => { throw new Error('fail'); };
            const onError = jest.fn(() => 'recovered');
            const wrapped = ErrorHandler.wrap(fn, onError);

            expect(await wrapped()).toBe('recovered');
            expect(onError).toHaveBeenCalled();
        });
    });

    describe('isUSSDError', () => {
        test('should return true for USSD errors', () => {
            expect(ErrorHandler.isUSSDError(new ValidationError('test'))).toBe(true);
            expect(ErrorHandler.isUSSDError(new StateNotFoundError('test'))).toBe(true);
        });

        test('should return false for regular errors', () => {
            expect(ErrorHandler.isUSSDError(new Error('test'))).toBe(false);
        });
    });

    describe('getUserMessage', () => {
        test('should return validation error message', () => {
            const error = new ValidationError('Name is required');
            expect(ErrorHandler.getUserMessage(error)).toBe('Name is required');
        });

        test('should return custom message for session expired', () => {
            const error = new SessionExpiredError('123');
            const messages = { SESSION_EXPIRED: 'Please start again' };

            expect(ErrorHandler.getUserMessage(error, messages)).toBe('Please start again');
        });

        test('should return default message', () => {
            const error = new StorageError('DB down', 'get');
            expect(ErrorHandler.getUserMessage(error)).toBe('An error occurred. Please try again.');
        });
    });

    describe('formatForLogging', () => {
        test('should format USSD error as JSON', () => {
            const error = new ValidationError('Invalid');
            const formatted = ErrorHandler.formatForLogging(error);

            expect(formatted.name).toBe('ValidationError');
            expect(formatted.code).toBe('VALIDATION_ERROR');
        });

        test('should format regular error', () => {
            const error = new Error('Regular error');
            const formatted = ErrorHandler.formatForLogging(error);

            expect(formatted.name).toBe('Error');
            expect(formatted.timestamp).toBeDefined();
        });
    });
});
