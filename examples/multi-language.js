/**
 * Multi-language USSD Example
 * 
 * Demonstrates internationalization (i18n) support with language selection.
 * 
 * Run: node examples/multi-language.js
 */

const {
    USSDStateMachine,
    ResponseBuilder,
    InMemoryStorage,
    I18n,
    createUSSDI18n,
    LanguageDetector
} = require('../index');

// Create i18n instance with custom translations
const i18n = createUSSDI18n();

// Add app-specific translations
i18n.addTranslations('en', {
    app: {
        title: 'Mobile Banking',
        balance: 'Check Balance',
        transfer: 'Send Money',
        airtime: 'Buy Airtime',
        settings: 'Settings',
        yourBalance: 'Your balance is {{amount}}',
        selectLang: 'Select language'
    }
});

i18n.addTranslations('sw', {
    app: {
        title: 'Benki ya Simu',
        balance: 'Angalia Salio',
        transfer: 'Tuma Pesa',
        airtime: 'Nunua Airtime',
        settings: 'Mipangilio',
        yourBalance: 'Salio lako ni {{amount}}',
        selectLang: 'Chagua lugha'
    }
});

i18n.addTranslations('fr', {
    app: {
        title: 'Banque Mobile',
        balance: 'Vérifier le Solde',
        transfer: 'Envoyer de l\'Argent',
        airtime: 'Acheter du Crédit',
        settings: 'Paramètres',
        yourBalance: 'Votre solde est {{amount}}',
        selectLang: 'Choisir la langue'
    }
});

// Create state machine with language support
const ussd = new USSDStateMachine({
    initialState: 'LANG_SELECT',
    storage: new InMemoryStorage(),
    states: {
        LANG_SELECT: {
            handler: async (input, sessionId, context) => {
                return {
                    response: 'CON Select language / Chagua lugha:\n' +
                        '1. English\n' +
                        '2. Kiswahili\n' +
                        '3. Français',
                    nextState: 'SET_LANGUAGE'
                };
            }
        },

        SET_LANGUAGE: {
            handler: async (input, sessionId, context) => {
                const languages = { '1': 'en', '2': 'sw', '3': 'fr' };
                const lang = languages[input];

                if (!lang) {
                    return {
                        response: 'CON Invalid option. Please try again:\n' +
                            '1. English\n' +
                            '2. Kiswahili\n' +
                            '3. Français',
                        nextState: 'SET_LANGUAGE'
                    };
                }

                // Create translator for selected language
                const t = i18n.createTranslator(lang);

                return {
                    response: ResponseBuilder.menu(t('app.title'), [
                        t('app.balance'),
                        t('app.transfer'),
                        t('app.airtime'),
                        t('app.settings')
                    ]),
                    nextState: 'MAIN_MENU',
                    data: { language: lang }
                };
            }
        },

        MAIN_MENU: {
            handler: async (input, sessionId, context) => {
                const lang = context.sessionData?.language || 'en';
                const t = i18n.createTranslator(lang);

                switch (input) {
                    case '1':
                        return {
                            response: ResponseBuilder.end(
                                t('app.yourBalance', { params: { amount: '$150.00' } })
                            )
                        };
                    case '2':
                        return {
                            response: `CON ${t('common.enter')} phone:`,
                            nextState: 'TRANSFER_PHONE'
                        };
                    case '3':
                        return {
                            response: ResponseBuilder.menu(t('app.airtime'), ['$1', '$5', '$10']),
                            nextState: 'BUY_AIRTIME'
                        };
                    case '4':
                        return {
                            response: ResponseBuilder.menu(t('app.settings'), [
                                t('app.selectLang')
                            ]),
                            nextState: 'SETTINGS'
                        };
                    default:
                        return {
                            response: `CON ${t('common.invalidInput')}\n${t('common.tryAgain')}`,
                            nextState: 'MAIN_MENU'
                        };
                }
            }
        },

        TRANSFER_PHONE: {
            handler: async (input, sessionId, context) => {
                const lang = context.sessionData?.language || 'en';
                const t = i18n.createTranslator(lang);

                return {
                    response: `CON ${t('common.enter')} amount:`,
                    nextState: 'TRANSFER_AMOUNT',
                    data: { recipient: input }
                };
            }
        },

        TRANSFER_AMOUNT: {
            handler: async (input, sessionId, context) => {
                const lang = context.sessionData?.language || 'en';
                const t = i18n.createTranslator(lang);
                const recipient = context.sessionData?.recipient;

                return {
                    response: ResponseBuilder.end(
                        `${t('common.thankYou')}!\n` +
                        `Sent $${input} to ${recipient}`
                    )
                };
            }
        },

        BUY_AIRTIME: {
            handler: async (input, sessionId, context) => {
                const lang = context.sessionData?.language || 'en';
                const t = i18n.createTranslator(lang);
                const amounts = { '1': 1, '2': 5, '3': 10 };
                const amount = amounts[input];

                if (amount) {
                    return {
                        response: ResponseBuilder.end(
                            `${t('common.thankYou')}!\n` +
                            `Purchased $${amount} airtime`
                        )
                    };
                }

                return {
                    response: `CON ${t('common.invalidInput')}`,
                    nextState: 'BUY_AIRTIME'
                };
            }
        },

        SETTINGS: {
            handler: async (input, sessionId, context) => {
                if (input === '1') {
                    return {
                        response: 'CON Select language / Chagua lugha:\n' +
                            '1. English\n' +
                            '2. Kiswahili\n' +
                            '3. Français',
                        nextState: 'SET_LANGUAGE'
                    };
                }

                return {
                    response: 'CON Invalid option',
                    nextState: 'SETTINGS'
                };
            }
        }
    }
});

// Simulation
async function simulate() {
    const sessionId = 'multi-lang-' + Date.now();

    console.log('=== Multi-Language USSD Demo ===\n');

    // Initial dial
    let response = await ussd.processInput(sessionId, '');
    console.log('Response:', response);
    console.log('---');

    // Select Swahili
    response = await ussd.processInput(sessionId, '2');
    console.log('User selects: 2 (Kiswahili)');
    console.log('Response:', response);
    console.log('---');

    // Check balance
    response = await ussd.processInput(sessionId, '1');
    console.log('User selects: 1 (Check Balance)');
    console.log('Response:', response);
}

if (require.main === module) {
    simulate().catch(console.error);
}

module.exports = ussd;
