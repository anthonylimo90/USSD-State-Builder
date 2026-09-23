/**
 * Koa Integration Example
 *
 * Shows how to integrate the USSD State Machine with Koa framework.
 * Uses koa-router for routing and includes middleware patterns.
 *
 * Install: npm install koa koa-router koa-bodyparser
 * Run: node examples/koa-integration.js
 */

const { createApp } = require('../lib/sdk');

// Create USSD application
const app = createApp()
  .state('welcome', s => s
    .message('Welcome to Koa USSD\n1. Account Info\n2. Support\n3. Exit')
    .on('1').goto('account')
    .on('2').goto('support')
    .on('3').end('Goodbye!')
  )
  .state('account', s => s
    .handler(async (input, sessionId, ctx) => {
      return 'Your account: ACC-12345\nStatus: Active';
    })
    .end()
  )
  .state('support', s => s
    .message('Enter your message:')
    .save('supportMessage')
    .next('support_confirm')
  )
  .state('support_confirm', s => s
    .handler(async (input, sessionId, ctx) => {
      return `Message received: "${ctx.sessionData.supportMessage}". We'll get back to you.`;
    })
    .end()
  )
  .start('welcome')
  .logging({ logger: console.log })
  .build();

async function startServer() {
  const Koa = require('koa');
  const Router = require('koa-router');
  const bodyParser = require('koa-bodyparser');

  const server = new Koa();
  const router = new Router();

  // Middleware for error handling
  server.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      ctx.status = err.status || 500;
      ctx.body = { error: err.message };
      ctx.app.emit('error', err, ctx);
    }
  });

  // USSD endpoint
  router.post('/ussd', async (ctx) => {
    const { sessionId, text } = ctx.request.body;

    try {
      const response = await app.processInput(sessionId, text || '');
      ctx.body = { response };
    } catch (error) {
      console.error('USSD Error:', error);
      ctx.body = { response: 'END An error occurred. Please try again.' };
    }
  });

  // Health check
  router.get('/health', (ctx) => {
    ctx.body = { status: 'healthy', uptime: process.uptime() };
  });

  // Metrics
  router.get('/metrics', (ctx) => {
    ctx.body = app.getMetrics ? app.getMetrics() : { message: 'Metrics not enabled' };
  });

  server.use(bodyParser());
  server.use(router.routes());
  server.use(router.allowedMethods());

  // Start server
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Koa USSD server running on port ${port}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
