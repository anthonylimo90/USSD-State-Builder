/**
 * Hapi Integration Example
 *
 * Shows how to integrate the USSD State Machine with Hapi framework.
 * Uses Hapi's plugin system for modular integration.
 *
 * Install: npm install @hapi/hapi
 * Run: node examples/hapi-integration.js
 */

const { createApp } = require('../lib/sdk');

// Create USSD application
const app = createApp()
  .state('welcome', s => s
    .message('Welcome to Hapi USSD\n1. My Profile\n2. Settings\n3. Logout')
    .on('1').goto('profile')
    .on('2').goto('settings')
    .on('3').end('You have been logged out.')
  )
  .state('profile', s => s
    .handler(async (input, sessionId, ctx) => {
      return 'Name: John Doe\nPhone: +254712345678\nPlan: Premium';
    })
    .end()
  )
  .state('settings', s => s
    .message('Settings:\n1. Change Language\n2. Change PIN\n0. Back')
    .on('1').goto('language')
    .on('2').goto('pin')
  )
  .state('language', s => s
    .message('Select Language:\n1. English\n2. Swahili\n3. French')
    .save('language')
    .handler(async (input) => {
      const langs = { '1': 'English', '2': 'Swahili', '3': 'French' };
      return `Language set to ${langs[input] || 'Unknown'}`;
    })
    .end()
  )
  .state('pin', s => s
    .message('Enter new PIN (4 digits):')
    .validate(input => {
      if (!/^\d{4}$/.test(input)) {
        throw new Error('PIN must be exactly 4 digits');
      }
    })
    .save('newPin')
    .handler(async () => 'PIN updated successfully!')
    .end()
  )
  .start('welcome')
  .backNavigation(true)
  .build();

// Hapi plugin for USSD
const ussdPlugin = {
  name: 'ussd',
  version: '1.0.0',
  register: async function (server) {
    // USSD route
    server.route({
      method: 'POST',
      path: '/ussd',
      handler: async (request, h) => {
        const { sessionId, text } = request.payload;

        try {
          const response = await app.processInput(sessionId, text || '');
          return { response };
        } catch (error) {
          console.error('USSD Error:', error);
          return { response: 'END An error occurred. Please try again.' };
        }
      }
    });

    // Health check route
    server.route({
      method: 'GET',
      path: '/health',
      handler: (request, h) => ({
        status: 'healthy',
        uptime: process.uptime()
      })
    });

    // Metrics route
    server.route({
      method: 'GET',
      path: '/metrics',
      handler: (request, h) => {
        return app.getMetrics ? app.getMetrics() : { message: 'Metrics not enabled' };
      }
    });
  }
};

async function startServer() {
  const Hapi = require('@hapi/hapi');

  const server = Hapi.server({
    port: process.env.PORT || 3000,
    host: '0.0.0.0'
  });

  // Register USSD plugin
  await server.register(ussdPlugin);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    if (app.cleanup) app.cleanup();
    await server.stop();
    process.exit(0);
  });

  await server.start();
  console.log(`Hapi USSD server running on ${server.info.uri}`);

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, ussdPlugin, startServer };
