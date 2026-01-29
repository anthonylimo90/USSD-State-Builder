const { createApp, DynamicMenu, DynamicMenuBuilder } = require('../../lib/sdk');

describe('DynamicMenu', () => {
  describe('DynamicMenuBuilder', () => {
    test('throws error if no fetcher is set', () => {
      const builder = new DynamicMenuBuilder();
      expect(() => builder.build()).toThrow('DynamicMenuBuilder requires a fetcher function');
    });

    test('DynamicMenu.create() returns a DynamicMenuBuilder', () => {
      const builder = DynamicMenu.create();
      expect(builder).toBeInstanceOf(DynamicMenuBuilder);
    });

    test('DynamicMenu.from() returns a DynamicMenuBuilder with fetcher', () => {
      const fetcher = async () => ['a', 'b', 'c'];
      const builder = DynamicMenu.from(fetcher);
      expect(builder).toBeInstanceOf(DynamicMenuBuilder);
      // Should not throw because fetcher is set
      expect(() => builder.build()).not.toThrow();
    });
  });

  describe('Basic menu rendering', () => {
    test('renders menu items from fetched data', async () => {
      const mockAccounts = [
        { id: 1, name: 'Savings', balance: 1000 },
        { id: 2, name: 'Checking', balance: 500 },
        { id: 3, name: 'Investment', balance: 5000 }
      ];

      const app = createApp()
        .state('selectAccount', s => s
          .run(
            DynamicMenu.from(async () => mockAccounts)
              .format(item => `${item.name} - KES ${item.balance}`)
              .header('Select account:')
              .build()
          )
          .save('accountId')
          .next('details')
        )
        .state('details', s => s
          .message('Account details')
          .end()
        )
        .start('selectAccount')
        .logger(null)
        .build();

      const res = await app.processInput('sess1', '');
      expect(res).toBe('CON Select account:\n1. Savings - KES 1000\n2. Checking - KES 500\n3. Investment - KES 5000');
    });

    test('renders simple items without custom formatter', async () => {
      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => ['Apple', 'Banana', 'Cherry'])
              .header('Select fruit:')
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      const res = await app.processInput('sess2', '');
      expect(res).toBe('CON Select fruit:\n1. Apple\n2. Banana\n3. Cherry');
    });
  });

  describe('Item selection', () => {
    test('selects item and extracts value', async () => {
      const mockItems = [
        { id: 'acc1', name: 'Savings' },
        { id: 'acc2', name: 'Checking' }
      ];

      const app = createApp()
        .state('selectAccount', s => s
          .run(
            DynamicMenu.from(async () => mockItems)
              .format(item => item.name)
              .value(item => item.id)
              .header('Select:')
              .build()
          )
          .save('accountId')
          .next('confirm')
        )
        .state('confirm', s => s
          .run(async (input, sid, ctx) => `Selected: ${ctx.sessionData.accountId}`)
          .end()
        )
        .start('selectAccount')
        .logger(null)
        .build();

      await app.processInput('sess3', '');
      const res = await app.processInput('sess3', '2'); // Select "Checking"
      expect(res).toBe('END Selected: acc2');
    });

    test('invalid selection shows menu again', async () => {
      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => ['A', 'B'])
              .header('Select:')
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      await app.processInput('sess4', '');
      const res = await app.processInput('sess4', '99'); // Invalid selection
      expect(res).toBe('CON Select:\n1. A\n2. B');
    });

    test('works with save function mapper', async () => {
      const mockItems = [
        { id: 1, amount: 100 },
        { id: 2, amount: 200 }
      ];

      const app = createApp()
        .state('selectAmount', s => s
          .run(
            DynamicMenu.from(async () => mockItems)
              .format(item => `KES ${item.amount}`)
              .value(item => item.amount)
              .header('Select amount:')
              .build()
          )
          .save((selectedValue, ctx) => ({
            ...ctx.sessionData,
            amount: selectedValue,
            currency: 'KES'
          }))
          .next('confirm')
        )
        .state('confirm', s => s
          .run(async (input, sid, ctx) =>
            `Amount: ${ctx.sessionData.currency} ${ctx.sessionData.amount}`)
          .end()
        )
        .start('selectAmount')
        .logger(null)
        .build();

      await app.processInput('sess5', '');
      const res = await app.processInput('sess5', '2');
      expect(res).toBe('END Amount: KES 200');
    });
  });

  describe('Pagination', () => {
    test('paginates items with default keys', async () => {
      const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => items)
              .header('Select:')
              .paginated({ pageSize: 3 })
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      // First page
      const res1 = await app.processInput('sess6', '');
      expect(res1).toBe('CON Select:\n1. A\n2. B\n3. C\n99. More');

      // Go to next page
      const res2 = await app.processInput('sess6', '99');
      expect(res2).toBe('CON Select:\n1. D\n2. E\n3. F\n98. Back\n99. More');

      // Go to last page
      const res3 = await app.processInput('sess6', '99');
      expect(res3).toBe('CON Select:\n1. G\n2. H\n98. Back');
    });

    test('paginates with custom keys and labels', async () => {
      const items = ['One', 'Two', 'Three', 'Four', 'Five'];

      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => items)
              .header('Choose:')
              .paginated({
                pageSize: 2,
                moreKey: '#',
                backKey: '*',
                moreLabel: 'Next',
                backLabel: 'Previous'
              })
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      const res1 = await app.processInput('sess7', '');
      expect(res1).toBe('CON Choose:\n1. One\n2. Two\n#. Next');

      const res2 = await app.processInput('sess7', '#');
      expect(res2).toBe('CON Choose:\n1. Three\n2. Four\n*. Previous\n#. Next');
    });

    test('selects item from correct page', async () => {
      const items = [
        { id: 1, name: 'First' },
        { id: 2, name: 'Second' },
        { id: 3, name: 'Third' },
        { id: 4, name: 'Fourth' }
      ];

      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => items)
              .format(item => item.name)
              .value(item => item.id)
              .paginated({ pageSize: 2 })
              .build()
          )
          .save('itemId')
          .next('confirm')
        )
        .state('confirm', s => s
          .run(async (input, sid, ctx) => `ID: ${ctx.sessionData.itemId}`)
          .end()
        )
        .start('selectItem')
        .logger(null)
        .build();

      await app.processInput('sess8', ''); // Page 1
      await app.processInput('sess8', '99'); // Go to page 2
      const res = await app.processInput('sess8', '1'); // Select "Third" (first on page 2)
      expect(res).toBe('END ID: 3');
    });

    test('navigates back to previous page', async () => {
      const items = ['A', 'B', 'C', 'D'];

      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => items)
              .paginated({ pageSize: 2 })
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      await app.processInput('sess9', ''); // Page 1
      await app.processInput('sess9', '99'); // Page 2
      const res = await app.processInput('sess9', '98'); // Back to page 1
      expect(res).toBe('CON 1. A\n2. B\n99. More');
    });
  });

  describe('Empty data handling', () => {
    test('shows empty message and ends session by default', async () => {
      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => [])
              .header('Select:')
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      const res = await app.processInput('sess10', '');
      expect(res).toBe('END No items available');
    });

    test('shows custom empty message', async () => {
      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => [])
              .onEmpty('No accounts found')
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      const res = await app.processInput('sess11', '');
      expect(res).toBe('END No accounts found');
    });

    test('continues session on empty with action=continue', async () => {
      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => [])
              .onEmpty('No items. Try again later.', 'continue')
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      const res = await app.processInput('sess12', '');
      expect(res).toBe('CON No items. Try again later.');
    });
  });

  describe('Error handling', () => {
    test('shows default error message on fetch failure', async () => {
      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => {
              throw new Error('Network error');
            })
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      const res = await app.processInput('sess13', '');
      expect(res).toBe('END An error occurred. Please try again later.');
    });

    test('uses custom error handler', async () => {
      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => {
              throw new Error('API timeout');
            })
              .onError((err) => `Service unavailable: ${err.message}`)
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      const res = await app.processInput('sess14', '');
      expect(res).toBe('END Service unavailable: API timeout');
    });

    test('error handler can return full response object', async () => {
      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => {
              throw new Error('Oops');
            })
              .onError(() => ({ response: 'CON Error occurred. Press 1 to retry.' }))
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      const res = await app.processInput('sess15', '');
      expect(res).toBe('CON Error occurred. Press 1 to retry.');
    });
  });

  describe('Convenience method .dynamicMenu()', () => {
    test('works with basic options', async () => {
      const items = [
        { id: 1, name: 'Option A' },
        { id: 2, name: 'Option B' }
      ];

      const app = createApp()
        .state('select', s => s
          .dynamicMenu(
            async () => items,
            {
              format: item => item.name,
              value: item => item.id,
              header: 'Choose option:'
            }
          )
          .save('selectedId')
          .next('result')
        )
        .state('result', s => s
          .run(async (input, sid, ctx) => `You chose: ${ctx.sessionData.selectedId}`)
          .end()
        )
        .start('select')
        .logger(null)
        .build();

      const res1 = await app.processInput('sess16', '');
      expect(res1).toBe('CON Choose option:\n1. Option A\n2. Option B');

      const res2 = await app.processInput('sess16', '1');
      expect(res2).toBe('END You chose: 1');
    });

    test('works with pagination options', async () => {
      const items = ['A', 'B', 'C', 'D', 'E'];

      const app = createApp()
        .state('select', s => s
          .dynamicMenu(
            async () => items,
            {
              header: 'Select:',
              pageSize: 2,
              moreKey: '#',
              moreLabel: 'Next'
            }
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('select')
        .logger(null)
        .build();

      const res = await app.processInput('sess17', '');
      expect(res).toBe('CON Select:\n1. A\n2. B\n#. Next');
    });

    test('works with empty and error options', async () => {
      const app = createApp()
        .state('select', s => s
          .dynamicMenu(
            async () => [],
            {
              empty: { message: 'Nothing here', action: 'end' }
            }
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('select')
        .logger(null)
        .build();

      const res = await app.processInput('sess18', '');
      expect(res).toBe('END Nothing here');
    });
  });

  describe('Integration with createApp flow', () => {
    test('nested dynamic menus (category -> products)', async () => {
      const categories = [
        { id: 'electronics', name: 'Electronics' },
        { id: 'clothing', name: 'Clothing' }
      ];

      const products = {
        electronics: [
          { id: 'phone', name: 'Phone', price: 500 },
          { id: 'laptop', name: 'Laptop', price: 1000 }
        ],
        clothing: [
          { id: 'shirt', name: 'Shirt', price: 50 },
          { id: 'pants', name: 'Pants', price: 80 }
        ]
      };

      const app = createApp()
        .state('selectCategory', s => s
          .dynamicMenu(
            async () => categories,
            {
              format: item => item.name,
              value: item => item.id,
              header: 'Select category:'
            }
          )
          .save('category')
          .next('selectProduct')
        )
        .state('selectProduct', s => s
          .run(
            DynamicMenu.from(async (sid, ctx) => products[ctx.sessionData.category])
              .format(item => `${item.name} - $${item.price}`)
              .value(item => item.id)
              .header('Select product:')
              .build()
          )
          .save('product')
          .next('confirm')
        )
        .state('confirm', s => s
          .run(async (input, sid, ctx) =>
            `Category: ${ctx.sessionData.category}, Product: ${ctx.sessionData.product}`)
          .end()
        )
        .start('selectCategory')
        .logger(null)
        .build();

      // Select category
      const catMenu = await app.processInput('sess19', '');
      expect(catMenu).toBe('CON Select category:\n1. Electronics\n2. Clothing');

      // Select Electronics - this transitions to selectProduct and shows products
      const prodMenu = await app.processInput('sess19', '1');
      expect(prodMenu).toBe('CON Select product:\n1. Phone - $500\n2. Laptop - $1000');

      // Select Laptop
      const res = await app.processInput('sess19', '2');
      expect(res).toBe('END Category: electronics, Product: laptop');
    });

    test('data persists through flow', async () => {
      const accounts = [
        { id: 'a1', name: 'Savings', balance: 1000 }
      ];

      const app = createApp()
        .state('enterPhone', s => s
          .message('Enter phone:')
          .save('phone')
          .next('selectAccount')
        )
        .state('selectAccount', s => s
          .dynamicMenu(
            async () => accounts,
            {
              format: item => `${item.name} - $${item.balance}`,
              value: item => item.id,
              header: 'Select account:'
            }
          )
          .save('account')
          .next('confirm')
        )
        .state('confirm', s => s
          .run(async (input, sid, ctx) =>
            `Phone: ${ctx.sessionData.phone}, Account: ${ctx.sessionData.account}`)
          .end()
        )
        .start('enterPhone')
        .logger(null)
        .build();

      await app.processInput('sess20', '');
      await app.processInput('sess20', '0712345678');
      const res = await app.processInput('sess20', '1');
      expect(res).toBe('END Phone: 0712345678, Account: a1');
    });
  });

  describe('SDK exports', () => {
    test('DynamicMenu is exported from SDK', () => {
      const sdk = require('../../lib/sdk');
      expect(sdk.DynamicMenu).toBeDefined();
      expect(typeof sdk.DynamicMenu.create).toBe('function');
      expect(typeof sdk.DynamicMenu.from).toBe('function');
    });

    test('DynamicMenuBuilder is exported from SDK', () => {
      const sdk = require('../../lib/sdk');
      expect(sdk.DynamicMenuBuilder).toBeDefined();
      expect(typeof sdk.DynamicMenuBuilder).toBe('function');
    });

    test('DynamicMenu is exported from main index', () => {
      const main = require('../../index');
      expect(main.DynamicMenu).toBeDefined();
      expect(typeof main.DynamicMenu.create).toBe('function');
      expect(typeof main.DynamicMenu.from).toBe('function');
    });

    test('DynamicMenuBuilder is exported from main index', () => {
      const main = require('../../index');
      expect(main.DynamicMenuBuilder).toBeDefined();
      expect(typeof main.DynamicMenuBuilder).toBe('function');
    });

    test('DynamicMenu is exported from sdk entry point', () => {
      const sdk = require('../../sdk');
      expect(sdk.DynamicMenu).toBeDefined();
      expect(typeof sdk.DynamicMenu.create).toBe('function');
      expect(typeof sdk.DynamicMenu.from).toBe('function');
    });
  });

  describe('maxItems (memory management)', () => {
    test('limits items stored in session', async () => {
      const largeDataset = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }));

      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => largeDataset)
              .format(item => item.name)
              .value(item => item.id)
              .maxItems(10)
              .paginated({ pageSize: 5 })
              .build()
          )
          .save('itemId')
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      // First page should show first 5 of the 10 max items
      const res1 = await app.processInput('sess-max1', '');
      expect(res1).toBe('CON 1. Item 0\n2. Item 1\n3. Item 2\n4. Item 3\n5. Item 4\n99. More');

      // Second page should show items 5-9 (only 5 items left from max 10)
      const res2 = await app.processInput('sess-max1', '99');
      expect(res2).toBe('CON 1. Item 5\n2. Item 6\n3. Item 7\n4. Item 8\n5. Item 9\n98. Back');

      // No third page - only 10 items stored
    });

    test('works with convenience method', async () => {
      const largeDataset = Array.from({ length: 50 }, (_, i) => `Item ${i}`);

      const app = createApp()
        .state('select', s => s
          .dynamicMenu(
            async () => largeDataset,
            {
              maxItems: 5,
              header: 'Select:'
            }
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('select')
        .logger(null)
        .build();

      const res = await app.processInput('sess-max2', '');
      expect(res).toBe('CON Select:\n1. Item 0\n2. Item 1\n3. Item 2\n4. Item 3\n5. Item 4');
    });
  });

  describe('refreshable (data refresh)', () => {
    test('adds refresh option to menu', async () => {
      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => ['A', 'B', 'C'])
              .header('Select:')
              .refreshable()
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      const res = await app.processInput('sess-ref1', '');
      expect(res).toBe('CON Select:\n1. A\n2. B\n3. C\n0. Refresh');
    });

    test('re-fetches data on refresh key', async () => {
      let fetchCount = 0;
      const fetcher = async () => {
        fetchCount++;
        return [`Fetch ${fetchCount}`, 'B', 'C'];
      };

      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(fetcher)
              .header('Select:')
              .refreshable({ key: '*', label: 'Reload' })
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      // First fetch
      const res1 = await app.processInput('sess-ref2', '');
      expect(res1).toBe('CON Select:\n1. Fetch 1\n2. B\n3. C\n*. Reload');
      expect(fetchCount).toBe(1);

      // Trigger refresh
      const res2 = await app.processInput('sess-ref2', '*');
      expect(res2).toBe('CON Select:\n1. Fetch 2\n2. B\n3. C\n*. Reload');
      expect(fetchCount).toBe(2);
    });

    test('works with pagination', async () => {
      const items = ['A', 'B', 'C', 'D', 'E'];

      const app = createApp()
        .state('selectItem', s => s
          .run(
            DynamicMenu.from(async () => items)
              .paginated({ pageSize: 2 })
              .refreshable({ key: '#' })
              .build()
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('selectItem')
        .logger(null)
        .build();

      const res = await app.processInput('sess-ref3', '');
      expect(res).toBe('CON 1. A\n2. B\n99. More\n#. Refresh');
    });

    test('throws on key conflict with pagination', () => {
      expect(() => {
        DynamicMenu.from(async () => [])
          .paginated({ pageSize: 5, moreKey: '99' })
          .refreshable({ key: '99' })
          .build();
      }).toThrow('Refresh key "99" conflicts with pagination keys');
    });

    test('works with convenience method', async () => {
      let fetchCount = 0;

      const app = createApp()
        .state('select', s => s
          .dynamicMenu(
            async () => {
              fetchCount++;
              return [`Data ${fetchCount}`];
            },
            {
              header: 'Select:',
              refresh: { key: '0', label: 'Update' }
            }
          )
          .next('done')
        )
        .state('done', s => s.message('Done').end())
        .start('select')
        .logger(null)
        .build();

      await app.processInput('sess-ref4', '');
      expect(fetchCount).toBe(1);

      const res = await app.processInput('sess-ref4', '0');
      expect(res).toBe('CON Select:\n1. Data 2\n0. Update');
      expect(fetchCount).toBe(2);
    });
  });
});
