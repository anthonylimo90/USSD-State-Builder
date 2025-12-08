/**
 * Validation Example
 * 
 * Demonstrates the rich validation library for input validation.
 * 
 * Run: node examples/with-validation.js
 */

const {
    USSDStateMachine,
    ResponseBuilder,
    InMemoryStorage,
    Validators,
    combineValidators,
    ValidationError
} = require('../index');

const ussd = new USSDStateMachine({
    initialState: 'WELCOME',
    storage: new InMemoryStorage(),
    states: {
        WELCOME: {
            handler: async () => ({
                response: ResponseBuilder.menu('Register Account', [
                    'New Registration',
                    'Existing User Login'
                ]),
                nextState: 'MAIN_MENU'
            })
        },

        MAIN_MENU: {
            handler: async (input) => {
                if (input === '1') {
                    return {
                        response: 'CON Enter your full name:',
                        nextState: 'ENTER_NAME'
                    };
                } else if (input === '2') {
                    return {
                        response: 'CON Enter your phone number:',
                        nextState: 'LOGIN_PHONE'
                    };
                }
                return {
                    response: ResponseBuilder.error('Invalid option'),
                    nextState: 'MAIN_MENU'
                };
            }
        },

        ENTER_NAME: {
            handler: async (input, sessionId, context) => {
                return {
                    response: 'CON Enter your phone number (e.g., 0712345678):',
                    nextState: 'ENTER_PHONE',
                    data: { name: input }
                };
            },
            // Validate name (2-50 characters, letters and spaces only)
            validator: combineValidators(
                Validators.required('Please enter your name'),
                Validators.minLength({ length: 2, message: 'Name too short' }),
                Validators.maxLength({ length: 50, message: 'Name too long' }),
                Validators.pattern({
                    pattern: /^[a-zA-Z\s]+$/,
                    message: 'Name can only contain letters and spaces'
                })
            )
        },

        ENTER_PHONE: {
            handler: async (input, sessionId, context) => {
                return {
                    response: 'CON Enter your email address:',
                    nextState: 'ENTER_EMAIL',
                    data: { phone: input }
                };
            },
            // Validate Kenyan phone number
            validator: Validators.phone({
                country: 'KE',
                message: 'Please enter a valid Kenyan phone number'
            })
        },

        ENTER_EMAIL: {
            handler: async (input, sessionId, context) => {
                return {
                    response: 'CON Enter your age:',
                    nextState: 'ENTER_AGE',
                    data: { email: input }
                };
            },
            // Validate email
            validator: Validators.email('Please enter a valid email address')
        },

        ENTER_AGE: {
            handler: async (input, sessionId, context) => {
                return {
                    response: 'CON Create a 4-digit PIN:',
                    nextState: 'CREATE_PIN',
                    data: { age: parseInt(input) }
                };
            },
            // Validate age (18-120)
            validator: Validators.age({
                min: 18,
                max: 120,
                message: 'You must be at least 18 years old'
            })
        },

        CREATE_PIN: {
            handler: async (input, sessionId, context) => {
                return {
                    response: 'CON Confirm your PIN:',
                    nextState: 'CONFIRM_PIN',
                    data: { pin: input }
                };
            },
            // Validate PIN
            validator: Validators.pin({
                length: 4,
                numericOnly: true,
                message: 'PIN must be exactly 4 digits'
            })
        },

        CONFIRM_PIN: {
            handler: async (input, sessionId, context) => {
                const { pin, name, phone, email, age } = context.sessionData || {};

                if (input !== pin) {
                    return {
                        response: ResponseBuilder.error('PINs do not match. Please create PIN again:'),
                        nextState: 'CREATE_PIN'
                    };
                }

                return {
                    response: ResponseBuilder.end(
                        'Registration Successful!\n\n' +
                        `Name: ${name}\n` +
                        `Phone: ${phone}\n` +
                        `Email: ${email}\n` +
                        `Age: ${age}\n\n` +
                        'You can now login with your phone and PIN.'
                    )
                };
            }
        },

        LOGIN_PHONE: {
            handler: async (input, sessionId, context) => {
                return {
                    response: 'CON Enter your PIN:',
                    nextState: 'LOGIN_PIN',
                    data: { loginPhone: input }
                };
            },
            validator: Validators.phone({ country: 'KE' })
        },

        LOGIN_PIN: {
            handler: async (input, sessionId, context) => {
                // Simulate login verification
                return {
                    response: ResponseBuilder.end(
                        'Login Successful!\n\n' +
                        'Welcome back to our service.'
                    )
                };
            },
            validator: Validators.pin({ length: 4 })
        }
    }
});

// Handle validation errors gracefully
const originalProcessInput = ussd.processInput.bind(ussd);
ussd.processInput = async function (sessionId, input, options) {
    try {
        return await originalProcessInput(sessionId, input, options);
    } catch (error) {
        if (error instanceof ValidationError) {
            // Return the validation error as a response
            return `CON ${error.message}\n\nPlease try again:`;
        }
        throw error;
    }
};

// Simulation
async function simulate() {
    const sessionId = 'validation-' + Date.now();

    console.log('=== Validation Example ===\n');

    let response = await ussd.processInput(sessionId, '');
    console.log('Response:', response);
    console.log('---');

    // Select registration
    response = await ussd.processInput(sessionId, '1');
    console.log('User: 1');
    console.log('Response:', response);
    console.log('---');

    // Enter invalid name
    response = await ussd.processInput(sessionId, 'A');
    console.log('User: A (too short)');
    console.log('Response:', response);
    console.log('---');

    // Enter valid name
    response = await ussd.processInput(sessionId, 'John Doe');
    console.log('User: John Doe');
    console.log('Response:', response);
    console.log('---');

    // Enter valid phone
    response = await ussd.processInput(sessionId, '0712345678');
    console.log('User: 0712345678');
    console.log('Response:', response);
    console.log('---');

    // Enter valid email
    response = await ussd.processInput(sessionId, 'john@example.com');
    console.log('User: john@example.com');
    console.log('Response:', response);
    console.log('---');

    // Enter age
    response = await ussd.processInput(sessionId, '25');
    console.log('User: 25');
    console.log('Response:', response);
    console.log('---');

    // Create PIN
    response = await ussd.processInput(sessionId, '1234');
    console.log('User: 1234');
    console.log('Response:', response);
    console.log('---');

    // Confirm PIN
    response = await ussd.processInput(sessionId, '1234');
    console.log('User: 1234');
    console.log('Response:', response);
}

if (require.main === module) {
    simulate().catch(console.error);
}

module.exports = ussd;
