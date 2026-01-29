/**
 * SDK Dynamic Menu Example - Bank Account Selection
 *
 * Demonstrates the dynamic menu feature for fetching and displaying
 * data from external sources at runtime.
 *
 * Run with: node examples/sdk-dynamic-menu.js
 */
const { createApp, DynamicMenu } = require('../sdk');

// Mock API functions (would be real API calls in production)
const mockApi = {
  async getAccounts(userId) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));
    return [
      { id: 'acc1', name: 'Savings Account', balance: 15000, currency: 'KES' },
      { id: 'acc2', name: 'Checking Account', balance: 8500, currency: 'KES' },
      { id: 'acc3', name: 'Business Account', balance: 125000, currency: 'KES' },
      { id: 'acc4', name: 'Joint Account', balance: 45000, currency: 'KES' },
      { id: 'acc5', name: 'Investment Account', balance: 250000, currency: 'KES' },
      { id: 'acc6', name: 'Emergency Fund', balance: 30000, currency: 'KES' }
    ];
  },

  async getAccountDetails(accountId) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const accounts = {
      acc1: { name: 'Savings Account', balance: 15000, accountNumber: '1234567890' },
      acc2: { name: 'Checking Account', balance: 8500, accountNumber: '0987654321' },
      acc3: { name: 'Business Account', balance: 125000, accountNumber: '5555555555' },
      acc4: { name: 'Joint Account', balance: 45000, accountNumber: '1111111111' },
      acc5: { name: 'Investment Account', balance: 250000, accountNumber: '2222222222' },
      acc6: { name: 'Emergency Fund', balance: 30000, accountNumber: '3333333333' }
    };
    return accounts[accountId];
  },

  async getTransactions(accountId) {
    await new Promise(resolve => setTimeout(resolve, 50));
    return [
      { id: 't1', date: '2024-01-15', description: 'Salary', amount: 50000, type: 'credit' },
      { id: 't2', date: '2024-01-14', description: 'Rent', amount: -15000, type: 'debit' },
      { id: 't3', date: '2024-01-13', description: 'Groceries', amount: -2500, type: 'debit' },
      { id: 't4', date: '2024-01-12', description: 'Transfer', amount: -5000, type: 'debit' },
      { id: 't5', date: '2024-01-11', description: 'Utilities', amount: -3000, type: 'debit' }
    ];
  }
};

// Build the USSD application
const app = createApp()
  .state('welcome', s => s
    .message('Welcome to MyBank\n1. View Accounts\n2. View Transactions\n3. Exit')
    .on('1').goto('selectAccount')
    .on('2').goto('selectAccountForTx')
    .on('3').end('Thank you for using MyBank. Goodbye!')
  )

  // ============================================
  // EXAMPLE 1: Basic Dynamic Menu with Pagination
  // ============================================
  .state('selectAccount', s => s
    .run(
      DynamicMenu.from(async (sid, ctx) => mockApi.getAccounts('user123'))
        .format(item => `${item.name} - ${item.currency} ${item.balance.toLocaleString()}`)
        .value(item => item.id)
        .header('Select account to view:')
        .paginated({
          pageSize: 3,
          moreKey: '#',
          backKey: '*',
          moreLabel: 'More',
          backLabel: 'Back'
        })
        .onEmpty('No accounts found')
        .onError((err) => `Error loading accounts: ${err.message}`)
        .build()
    )
    .save('selectedAccountId')
    .next('accountDetails')
  )

  .state('accountDetails', s => s
    .run(async (input, sid, ctx) => {
      const account = await mockApi.getAccountDetails(ctx.sessionData.selectedAccountId);
      return [
        `Account: ${account.name}`,
        `Number: ${account.accountNumber}`,
        `Balance: KES ${account.balance.toLocaleString()}`,
        '',
        '1. Back to accounts',
        '2. Main menu'
      ].join('\n');
    })
    .on('1').goto('selectAccount')
    .on('2').goto('welcome')
  )

  // ============================================
  // EXAMPLE 2: Convenience Method with Memory & Refresh
  // ============================================
  .state('selectAccountForTx', s => s
    .dynamicMenu(
      async () => mockApi.getAccounts('user123'),
      {
        format: item => item.name,
        value: item => item.id,
        header: 'Select account for transactions:',
        pageSize: 4,
        maxItems: 50,  // Limit stored items to prevent memory issues
        refresh: { key: '*', label: 'Refresh' }  // Allow data refresh
      }
    )
    .save('txAccountId')
    .next('viewTransactions')
  )

  .state('viewTransactions', s => s
    .run(
      DynamicMenu.from(async (sid, ctx) => mockApi.getTransactions(ctx.sessionData.txAccountId))
        .format(item => {
          const sign = item.type === 'credit' ? '+' : '';
          return `${item.date}: ${item.description} (${sign}${item.amount.toLocaleString()})`;
        })
        .header('Recent transactions:')
        .paginated({ pageSize: 3 })
        .onEmpty('No transactions found')
        .build()
    )
    .on('98').goto('selectAccountForTx') // Back navigation
    .on('99').goto('viewTransactions')   // More (handled by dynamic menu)
  )

  .start('welcome')
  .backNavigation(true)
  .logger(null)
  .build();

// Simulate a USSD session
async function simulate() {
  const sessionId = 'dynamic-menu-demo';

  console.log('=== Dynamic Menu Demo ===\n');

  // Step 1: Welcome screen
  console.log('--- Starting session ---');
  let response = await app.processInput(sessionId, '');
  console.log('Response:', response, '\n');

  // Step 2: Select View Accounts
  console.log('--- User selects: 1 (View Accounts) ---');
  response = await app.processInput(sessionId, '1');
  console.log('Response:', response, '\n');

  // Step 3: Navigate to next page
  console.log('--- User selects: # (More) ---');
  response = await app.processInput(sessionId, '#');
  console.log('Response:', response, '\n');

  // Step 4: Select an account from page 2 (Investment Account is item 2)
  console.log('--- User selects: 2 (Investment Account) ---');
  response = await app.processInput(sessionId, '2');
  console.log('Response:', response, '\n');

  // Step 5: Go back to main menu
  console.log('--- User selects: 2 (Main menu) ---');
  response = await app.processInput(sessionId, '2');
  console.log('Response:', response, '\n');

  // Step 6: View transactions flow
  console.log('--- User selects: 2 (View Transactions) ---');
  response = await app.processInput(sessionId, '2');
  console.log('Response:', response, '\n');

  // Step 7: Select first account (Investment Account is item 1 on page 2)
  console.log('--- User selects: 1 (Investment Account) ---');
  response = await app.processInput(sessionId, '1');
  console.log('Response:', response, '\n');

  console.log('=== Demo Complete ===');
}

simulate().catch(console.error);
