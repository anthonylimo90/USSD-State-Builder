/**
 * Hot Reload Example
 *
 * Demonstrates how to update USSD states at runtime without restarting
 * the application. Useful for A/B testing, feature flags, and live
 * content updates in production.
 *
 * Run: node examples/hot-reload.js
 */

const {
    USSDStateMachine,
    ResponseBuilder,
    InMemoryStorage,
    HotReloader
} = require('../');

// --- Initial state machine setup ---

const storage = new InMemoryStorage();

const ussd = new USSDStateMachine({
    initialState: 'WELCOME',
    storage,
    states: {
        WELCOME: {
            handler: async () => ({
                response: ResponseBuilder.menu('Welcome to MobileBank', [
                    'Check Balance',
                    'Send Money'
                ]),
                nextState: 'MAIN_MENU'
            })
        },
        MAIN_MENU: {
            handler: async (input) => {
                if (input === '1') {
                    return { response: ResponseBuilder.end('Your balance is $100.00') };
                }
                if (input === '2') {
                    return { response: ResponseBuilder.end('Send Money coming soon.') };
                }
                return { response: ResponseBuilder.error('Invalid option') };
            }
        }
    }
});

// --- Create a HotReloader to manage live updates ---

const reloader = new HotReloader(ussd, {
    onReload: (type, stateName) => {
        console.log(`[hot-reload] ${type} state: ${stateName || 'all'}`);
    },
    preserveHistory: true
});

// Validate states before applying them to catch configuration errors early
const validation = reloader.validate(ussd.states);
console.log('Initial validation:', validation);

// --- Simulate runtime updates ---

async function demo() {
    // 1. Process a normal request with the original welcome message
    const res1 = await ussd.processInput('session-1', '');
    console.log('Before update:', res1);

    // 2. Update the welcome state with a promotional message
    reloader.updateState('WELCOME', {
        handler: async () => ({
            response: ResponseBuilder.menu('Welcome to MobileBank!\nNew: Instant Loans!', [
                'Check Balance',
                'Send Money',
                'Apply for Loan'
            ]),
            nextState: 'MAIN_MENU'
        })
    });

    // 3. Add a brand-new state for the loan feature
    reloader.addState('LOAN_APPLICATION', {
        handler: async (input) => {
            const amount = parseInt(input, 10);
            if (isNaN(amount) || amount < 100 || amount > 50000) {
                return { response: ResponseBuilder.con('Enter amount between 100 and 50000:') };
            }
            return { response: ResponseBuilder.end(`Loan of $${amount} approved!`) };
        }
    });

    // 4. Update the menu to route option 3 to the new loan state
    reloader.updateState('MAIN_MENU', {
        handler: async (input) => {
            if (input === '1') {
                return { response: ResponseBuilder.end('Your balance is $142.50') };
            }
            if (input === '2') {
                return { response: ResponseBuilder.end('Enter recipient phone number:'), nextState: 'SEND_MONEY' };
            }
            if (input === '3') {
                return { response: ResponseBuilder.con('Enter loan amount (100-50000):'), nextState: 'LOAN_APPLICATION' };
            }
            return { response: ResponseBuilder.error('Invalid option') };
        }
    });

    // 5. New sessions see the updated menu immediately
    const res2 = await ussd.processInput('session-2', '');
    console.log('After update:', res2);

    // 6. Inspect reload history and current state list
    console.log('Reload history:', reloader.getHistory());
    console.log('Active states:', reloader.getStateNames());
    console.log('State count:', reloader.getStateCount());

    // 7. Bulk reload all states at once (e.g., from a config file)
    //    Using merge mode to keep existing states and overlay changes
    reloader.reloadAll({
        WELCOME: {
            handler: async () => ({
                response: ResponseBuilder.menu('MobileBank v3 - Maintenance Window', [
                    'Check Balance'
                ]),
                nextState: 'MAIN_MENU'
            })
        }
    }, { merge: true });

    const res3 = await ussd.processInput('session-3', '');
    console.log('After bulk reload:', res3);
}

demo().catch(console.error);
