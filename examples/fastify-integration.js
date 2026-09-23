/**
 * Fastify Integration Example
 *
 * Shows how to integrate the USSD State Machine with Fastify framework.
 * Includes health checks, metrics endpoint, and graceful shutdown.
 *
 * Install: npm install fastify
 * Run: node examples/fastify-integration.js
 */

const { createApp } = require('../lib/sdk');

// Create USSD application
const app = createApp()
  .state('welcome', s => s
    .message('Welcome to Fastify USSD\n1. Check Balance\n2. Transfer\n3. Exit')
    .on('1').goto('balance')
    .on('2').goto('transfer')
    .on('3').end('Thank you for using our service!')
  )
  .state('balance', s => s
    .message('Your balance is KES 5,000.00')
    .end()
  )
  .state('transfer', s => s
    .message('Enter amount to transfer:')
    .validate(input => {
      const amount = parseFloat(input);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Please enter a valid amount');
      }
    })
    .save('amount')
    .next('transfer_confirm')
  )
  .state('transfer_confirm', s => s
    .handler(async (input, sessionId, ctx) => {
      return `Transfer of KES ${ctx.sessionData.amount} initiated.`;
    })
    .end()
  )
  .start('welcome')
  .metrics()
  .logging({ logger: console.log })
  .build();

// Fastify setup
async function startServer() {
  const fastify = require('fastify')({ logger: true });

  // USSD endpoint
  fastify.post('/ussd', async (request, reply) => {
    const { sessionId, text } = request.body;

    try {
      const response = await app.processInput(sessionId, text || '');
      return { response };
    } catch (error) {
      fastify.log.error(error);
      return { response: 'END An error occurred. Please try again.' };
    }
  });

  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'healthy', uptime: process.uptime() };
  });

  // Metrics endpoint
  fastify.get('/metrics', async () => {
    if (app.getMetrics) {
      return app.getMetrics();
    }
    return { message: 'Metrics not enabled' };
  });

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    if (app.cleanup) app.cleanup();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start server
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    fastify.log.info('USSD server running on port 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Only start if run directly
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
