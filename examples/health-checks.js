/**
 * Health Check Integration Example
 *
 * Demonstrates production-ready health checks with Express-style HTTP
 * endpoints, liveness/readiness probes for Kubernetes, custom dependency
 * checks, and graceful shutdown handling.
 *
 * Install: npm install express
 * Run: node examples/health-checks.js
 */

const {
    USSDStateMachine,
    ResponseBuilder,
    InMemoryStorage,
    HealthCheck,
    GracefulShutdown
} = require('../');

// --- Application setup ---

const storage = new InMemoryStorage();

const ussd = new USSDStateMachine({
    initialState: 'WELCOME',
    storage,
    states: {
        WELCOME: {
            handler: async () => ({
                response: ResponseBuilder.menu('HealthCheck Demo', ['Ping']),
                nextState: 'ACTION'
            })
        },
        ACTION: {
            handler: async () => ({
                response: ResponseBuilder.end('Pong!')
            })
        }
    }
});

// --- 1. Health Check with built-in and custom checks ---

const healthCheck = new HealthCheck({
    stateMachine: ussd,
    storage,
    cacheTTL: 5000, // Cache results for 5s to reduce overhead under load

    // Custom checks for external dependencies your app relies on
    checks: {
        database: async () => {
            // In production, replace with an actual DB ping
            const dbConnected = true;
            return {
                healthy: dbConnected,
                message: dbConnected ? 'Database reachable' : 'Database unreachable'
            };
        },
        externalApi: async () => {
            // Check that a third-party API is responding
            const latencyMs = 45; // Simulated latency
            return {
                healthy: latencyMs < 2000,
                message: `API latency: ${latencyMs}ms`
            };
        }
    },

    // Startup checks run once at boot before marking the service as ready
    startupChecks: {
        configLoaded: async () => ({
            healthy: true,
            message: 'Configuration loaded successfully'
        })
    }
});

// Add a check dynamically at runtime (e.g., after discovering a new dependency)
healthCheck.addCheck('diskSpace', async () => {
    const freePercent = 72; // Simulated
    return {
        healthy: freePercent > 10,
        message: `${freePercent}% disk free`
    };
});

// --- 2. Graceful Shutdown ---

const shutdown = new GracefulShutdown({
    storage,
    timeout: 15000, // Wait up to 15s for in-flight requests to finish
    onShutdown: async () => {
        console.log('[shutdown] Running pre-shutdown tasks (flush caches, etc.)');
    }
});

// Register custom cleanup handlers that run during shutdown
shutdown.addHandler(async () => {
    console.log('[shutdown] Closing database connections');
});
shutdown.addHandler(async () => {
    console.log('[shutdown] Flushing metrics buffer');
});

// Wire up OS signal handlers (SIGTERM, SIGINT, SIGUSR2)
shutdown.registerSignalHandlers();

// --- 3. Express integration with Kubernetes-style probes ---

// This section uses Express. If express is not installed, the demo
// falls back to running health checks directly (see bottom of file).

async function startServer() {
    const express = require('express');
    const app = express();
    app.use(express.json());

    // Shutdown-aware middleware: reject new requests during shutdown
    app.use((req, res, next) => {
        if (shutdown.isShutdownInProgress()) {
            return res.status(503).json({ error: 'Service is shutting down' });
        }
        shutdown.requestStart();
        res.on('finish', () => shutdown.requestEnd());
        next();
    });

    // Kubernetes liveness probe -- lightweight, always returns 200 if process is alive
    app.get('/healthz', healthCheck.livenessHandler());

    // Kubernetes readiness probe -- returns 503 until startup checks pass
    app.get('/ready', healthCheck.readinessHandler());

    // Detailed health endpoint for dashboards and monitoring
    app.get('/health', healthCheck.httpHandler());

    // USSD endpoint
    app.post('/ussd', async (req, res) => {
        const { sessionId, input } = req.body;
        try {
            const response = await ussd.processInput(sessionId, input || '');
            res.send(response);
        } catch (err) {
            res.send('END An error occurred.');
        }
    });

    const PORT = process.env.PORT || 3001;
    const server = app.listen(PORT, () => {
        console.log(`Health endpoints ready on http://localhost:${PORT}`);
        console.log(`  GET /healthz  - liveness probe`);
        console.log(`  GET /ready    - readiness probe`);
        console.log(`  GET /health   - detailed health`);
    });

    // Ensure the HTTP server closes during shutdown
    shutdown.addHandler(() => new Promise(resolve => server.close(resolve)));
}

// --- 4. Run startup checks, then start serving ---

async function main() {
    // Run one-time startup checks before accepting traffic
    const startupResult = await healthCheck.runStartupChecks();
    console.log('Startup checks:', startupResult);

    // Run a full health check to verify all components
    const health = await healthCheck.check();
    console.log('Health status:', JSON.stringify(health, null, 2));

    // Try to start the Express server; if express is not installed, just
    // demonstrate the health check API without HTTP
    try {
        require.resolve('express');
        await startServer();
    } catch {
        console.log('\nExpress is not installed. Showing health check output only.');
        console.log('Install express to enable HTTP endpoints: npm install express');
        const liveness = await healthCheck.liveness();
        console.log('Liveness:', liveness);
        const readiness = await healthCheck.readiness();
        console.log('Readiness:', readiness);
    }
}

main().catch(console.error);
