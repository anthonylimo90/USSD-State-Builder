/**
 * SDK Basic Example - Banking USSD App
 *
 * Demonstrates the fluent builder API for creating a USSD application.
 * Run with: node examples/sdk-basic.js
 */
const { createApp } = require('../sdk');
const { Validators } = require('../index');

const app = createApp()
  .state('welcome', s => s
    .message('Welcome to MyBank\n1. Check Balance\n2. Send Money\n3. Buy Airtime')
    .on('1').goto('balance')
    .on('2').goto('sendMoney')
    .on('3').goto('airtime')
  )
  .state('balance', s => s
    .run(async () => 'Your balance is KES 15,000.00')
    .end()
  )
  .state('sendMoney', s => s
    .message('Enter recipient phone number:')
    .validate(Validators.phone({ country: 'KE' }))
    .save('phone')
    .next('enterAmount')
  )
  .state('enterAmount', s => s
    .message('Enter amount (KES):')
    .validate(Validators.amount({ min: 10, max: 70000 }))
    .save('amount')
    .next('confirmSend')
  )
  .state('confirmSend', s => s
    .run(async (input, sid, ctx) => {
      const { phone, amount } = ctx.sessionData;
      return `Send KES ${amount} to ${phone}?\n1. Confirm\n2. Cancel`;
    })
    .on('1').end('Transaction successful! You sent the money.')
    .on('2').end('Transaction cancelled.')
  )
  .state('airtime', s => s
    .message('Enter amount (KES 10-10,000):')
    .validate(Validators.amount({ min: 10, max: 10000 }))
    .save('airtimeAmount')
    .next('confirmAirtime')
  )
  .state('confirmAirtime', s => s
    .run(async (input, sid, ctx) =>
      `Buy KES ${ctx.sessionData.airtimeAmount} airtime?\n1. Yes\n2. No`
    )
    .on('1').end('Airtime purchased successfully!')
    .on('2').end('Purchase cancelled.')
  )
  .start('welcome')
  .backNavigation(true)
  .logger(null)
  .build();

// Simulate a USSD session
async function simulate() {
  const sessionId = 'demo-session-1';

  console.log('=== Banking USSD Demo ===\n');

  // Step 1: User dials USSD code
  const welcome = await app.processInput(sessionId, '');
  console.log('Response:', welcome);

  // Step 2: User selects "Send Money"
  const sendMoney = await app.processInput(sessionId, '2');
  console.log('Response:', sendMoney);

  // Step 3: User enters phone number
  const amount = await app.processInput(sessionId, '0712345678');
  console.log('Response:', amount);

  // Step 4: User enters amount
  const confirm = await app.processInput(sessionId, '500');
  console.log('Response:', confirm);

  // Step 5: User confirms
  const result = await app.processInput(sessionId, '1');
  console.log('Response:', result);

  console.log('\n=== Session Complete ===');
}

simulate().catch(console.error);
