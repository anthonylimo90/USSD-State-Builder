/**
 * Basic USSD Menu Example
 * 
 * A simple USSD application demonstrating basic navigation and menus.
 * 
 * Run: node examples/basic-menu.js
 */

const { USSDStateMachine, ResponseBuilder, InMemoryStorage } = require('../index');

// Create the state machine
const ussd = new USSDStateMachine({
    initialState: 'WELCOME',
    timeout: 300,
    storage: new InMemoryStorage(),
    states: {
        WELCOME: {
            handler: async (input, sessionId, context) => {
                return {
                    response: ResponseBuilder.menu('Welcome to Our Service', [
                        'Check Balance',
                        'Send Money',
                        'Buy Airtime',
                        'My Account'
                    ]),
                    nextState: 'MAIN_MENU'
                };
            }
        },

        MAIN_MENU: {
            handler: async (input, sessionId, context) => {
                switch (input) {
                    case '1':
                        return {
                            response: ResponseBuilder.end('Your balance is $150.00'),
                        };
                    case '2':
                        return {
                            response: 'CON Enter phone number:',
                            nextState: 'SEND_MONEY_PHONE'
                        };
                    case '3':
                        return {
                            response: ResponseBuilder.menu('Select amount', [
                                '$1',
                                '$5',
                                '$10',
                                'Custom amount'
                            ]),
                            nextState: 'BUY_AIRTIME'
                        };
                    case '4':
                        return {
                            response: ResponseBuilder.menu('My Account', [
                                'View Profile',
                                'Change PIN',
                                'Transaction History'
                            ]),
                            nextState: 'MY_ACCOUNT'
                        };
                    default:
                        return {
                            response: ResponseBuilder.error('Invalid option'),
                            nextState: 'MAIN_MENU'
                        };
                }
            }
        },

        SEND_MONEY_PHONE: {
            handler: async (input, sessionId, context) => {
                // Store the phone number
                return {
                    response: 'CON Enter amount to send:',
                    nextState: 'SEND_MONEY_AMOUNT',
                    data: { recipientPhone: input }
                };
            }
        },

        SEND_MONEY_AMOUNT: {
            handler: async (input, sessionId, context) => {
                const amount = parseFloat(input);
                const phone = context.sessionData?.recipientPhone;

                return {
                    response: ResponseBuilder.confirm(
                        `Send $${amount.toFixed(2)} to ${phone}?`
                    ),
                    nextState: 'SEND_MONEY_CONFIRM',
                    data: { amount }
                };
            }
        },

        SEND_MONEY_CONFIRM: {
            handler: async (input, sessionId, context) => {
                if (input === '1') {
                    // Simulate processing
                    const { recipientPhone, amount } = context.sessionData || {};
                    return {
                        response: ResponseBuilder.end(
                            `Successfully sent $${amount?.toFixed(2)} to ${recipientPhone}\n` +
                            `Transaction ID: TX${Date.now()}`
                        )
                    };
                } else {
                    return {
                        response: ResponseBuilder.end('Transaction cancelled')
                    };
                }
            }
        },

        BUY_AIRTIME: {
            handler: async (input, sessionId, context) => {
                const amounts = { '1': 1, '2': 5, '3': 10 };
                const amount = amounts[input];

                if (amount) {
                    return {
                        response: ResponseBuilder.end(
                            `Successfully purchased $${amount} airtime\n` +
                            `Your new balance: $${150 - amount}.00`
                        )
                    };
                } else if (input === '4') {
                    return {
                        response: 'CON Enter custom amount:',
                        nextState: 'BUY_AIRTIME_CUSTOM'
                    };
                } else {
                    return {
                        response: ResponseBuilder.error('Invalid selection'),
                        nextState: 'BUY_AIRTIME'
                    };
                }
            }
        },

        BUY_AIRTIME_CUSTOM: {
            handler: async (input, sessionId, context) => {
                const amount = parseFloat(input);
                if (isNaN(amount) || amount <= 0) {
                    return {
                        response: ResponseBuilder.error('Invalid amount'),
                        nextState: 'BUY_AIRTIME_CUSTOM'
                    };
                }

                return {
                    response: ResponseBuilder.end(
                        `Successfully purchased $${amount.toFixed(2)} airtime`
                    )
                };
            }
        },

        MY_ACCOUNT: {
            handler: async (input, sessionId, context) => {
                switch (input) {
                    case '1':
                        return {
                            response: ResponseBuilder.end(
                                'Profile\n' +
                                '--------\n' +
                                'Name: John Doe\n' +
                                'Phone: +254712345678\n' +
                                'Account: Active'
                            )
                        };
                    case '2':
                        return {
                            response: 'CON Enter current PIN:',
                            nextState: 'CHANGE_PIN'
                        };
                    case '3':
                        return {
                            response: ResponseBuilder.end(
                                'Recent Transactions\n' +
                                '-------------------\n' +
                                '1. Sent $50 to 0722...\n' +
                                '2. Received $100 from 0733...\n' +
                                '3. Airtime $5'
                            )
                        };
                    default:
                        return {
                            response: ResponseBuilder.error('Invalid option'),
                            nextState: 'MY_ACCOUNT'
                        };
                }
            }
        },

        CHANGE_PIN: {
            handler: async (input, sessionId, context) => {
                // In real app, verify current PIN
                return {
                    response: 'CON Enter new PIN:',
                    nextState: 'CHANGE_PIN_NEW'
                };
            }
        },

        CHANGE_PIN_NEW: {
            handler: async (input, sessionId, context) => {
                if (input.length !== 4 || !/^\d+$/.test(input)) {
                    return {
                        response: ResponseBuilder.error('PIN must be 4 digits'),
                        nextState: 'CHANGE_PIN_NEW'
                    };
                }

                return {
                    response: ResponseBuilder.end('PIN changed successfully!')
                };
            }
        }
    }
});

// Simulate a USSD session
async function simulateSession() {
    const sessionId = 'test-session-' + Date.now();

    console.log('=== USSD Session Simulation ===\n');

    // Initial dial
    let response = await ussd.processInput(sessionId, '');
    console.log('User dials *123#');
    console.log('Response:', response);
    console.log('---');

    // Select "Check Balance"
    response = await ussd.processInput(sessionId, '1');
    console.log('User enters: 1');
    console.log('Response:', response);
}

// Run if executed directly
if (require.main === module) {
    simulateSession().catch(console.error);
}

module.exports = ussd;
