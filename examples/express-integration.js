/**
 * Express.js Integration Example
 * 
 * Shows how to integrate USSD State Builder with an Express.js server.
 * 
 * Install: npm install express
 * Run: node examples/express-integration.js
 */

const express = require('express');
const {
    USSDStateMachine,
    ResponseBuilder,
    InMemoryStorage,
    createLoggingMiddleware,
    createRateLimitMiddleware,
    HealthCheck,
    GracefulShutdown
} = require('../index');

// Create storage
const storage = new InMemoryStorage();

// Create the USSD state machine
const ussd = new USSDStateMachine({
    initialState: 'WELCOME',
    storage,
    states: {
        WELCOME: {
            handler: async () => ({
                response: ResponseBuilder.menu('Welcome!', ['Option 1', 'Option 2', 'Exit']),
                nextState: 'MENU'
            })
        },
        MENU: {
            handler: async (input) => {
                switch (input) {
                    case '1':
                        return { response: ResponseBuilder.end('You selected Option 1') };
                    case '2':
                        return { response: ResponseBuilder.end('You selected Option 2') };
                    case '3':
                        return { response: ResponseBuilder.end('Goodbye!') };
                    default:
                        return { response: ResponseBuilder.error('Invalid option'), nextState: 'MENU' };
                }
            }
        }
    }
});

// Add middleware
ussd.use(createLoggingMiddleware({ logTiming: true }));
ussd.use(createRateLimitMiddleware({ maxRequests: 20, windowMs: 60000 }));

// Create Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check setup
const healthCheck = new HealthCheck({ storage, stateMachine: ussd });

// Graceful shutdown setup
const gracefulShutdown = new GracefulShutdown({ storage, timeout: 10000 });
gracefulShutdown.registerSignalHandlers();

// USSD endpoint - handles Africa's Talking format
app.post('/ussd', async (req, res) => {
    const { sessionId, phoneNumber, text, serviceCode } = req.body;

    // Get the last input (text is cumulative)
    const inputs = text ? text.split('*') : [''];
    const currentInput = inputs[inputs.length - 1];

    try {
        const response = await ussd.processInput(sessionId, currentInput, {
            phoneNumber,
            serviceCode
        });

        res.set('Content-Type', 'text/plain');
        res.send(response);
    } catch (error) {
        console.error('USSD Error:', error);
        res.send('END An error occurred. Please try again.');
    }
});

// Alternative format - Twilio/generic
app.post('/ussd/generic', async (req, res) => {
    const { session_id, input, phone } = req.body;

    try {
        const response = await ussd.processInput(session_id, input || '');
        res.json({ response });
    } catch (error) {
        console.error('USSD Error:', error);
        res.status(500).json({ error: 'Processing failed' });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    const health = await healthCheck.check();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

// Liveness probe (for Kubernetes)
app.get('/health/live', (req, res) => {
    res.status(200).json({ status: 'alive' });
});

// Readiness probe (for Kubernetes)
app.get('/health/ready', async (req, res) => {
    if (gracefulShutdown.isShutdownInProgress()) {
        return res.status(503).json({ status: 'shutting down' });
    }

    const health = await healthCheck.getStatus();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`USSD Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`USSD endpoint: POST http://localhost:${PORT}/ussd`);
});

// Handle shutdown
gracefulShutdown.addHandler(async () => {
    return new Promise((resolve) => {
        server.close(() => {
            console.log('HTTP server closed');
            resolve();
        });
    });
});

module.exports = { app, ussd };
