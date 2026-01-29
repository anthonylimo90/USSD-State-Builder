/**
 * Tests for Form/Wizard Builder functionality
 */
const { createApp, FormBuilder, FieldBuilder } = require('../../lib/sdk');
const { Validators } = require('../../lib/ValidationLibrary');

describe('SDK Form Builder', () => {
  describe('Basic form creation', () => {
    it('should create states for each field', async () => {
      const app = createApp()
        .form('sendMoney', f => f
          .field('phone', field => field.prompt('Enter phone:'))
          .field('amount', field => field.prompt('Enter amount:'))
          .onComplete('done')
        )
        .state('done', s => s.message('Complete').end())
        .start('sendMoney_phone')
        .build();

      // First field
      let response = await app.processInput('session1', '');
      expect(response).toBe('CON Enter phone:');

      // Input phone, move to amount
      response = await app.processInput('session1', '0712345678');
      expect(response).toBe('CON Enter amount:');

      // Input amount, move to done
      response = await app.processInput('session1', '100');
      expect(response).toBe('END Complete');
    });

    it('should save field values to session data', async () => {
      let capturedData = null;

      const app = createApp()
        .form('register', f => f
          .field('name', field => field.prompt('Enter name:'))
          .field('age', field => field.prompt('Enter age:'))
          .onComplete('summary')
        )
        .state('summary', s => s
          .run(async (input, sid, ctx) => {
            capturedData = ctx.sessionData;
            return 'Done';
          })
          .end()
        )
        .start('register_name')
        .build();

      await app.processInput('session1', '');
      await app.processInput('session1', 'John');
      await app.processInput('session1', '25');

      expect(capturedData).toEqual({ name: 'John', age: '25' });
    });

    it('should apply validators to fields', async () => {
      const app = createApp()
        .form('payment', f => f
          .field('amount', field => field
            .prompt('Enter amount:')
            .validate(Validators.numeric({ min: 10, max: 1000 }))
          )
          .onComplete('done')
        )
        .state('done', s => s.message('Done').end())
        .start('payment_amount')
        .build();

      await app.processInput('session1', '');

      // Invalid input
      const response = await app.processInput('session1', '5');
      expect(response).toContain('CON');
      expect(response).toContain('Please try again');
    });

    it('should apply transform to field values', async () => {
      let capturedData = null;

      const app = createApp()
        .form('data', f => f
          .field('value', field => field
            .prompt('Enter number:')
            .transform(input => parseInt(input, 10) * 2)
          )
          .onComplete('result')
        )
        .state('result', s => s
          .run(async (input, sid, ctx) => {
            capturedData = ctx.sessionData;
            return 'Done';
          })
          .end()
        )
        .start('data_value')
        .build();

      await app.processInput('session1', '');
      await app.processInput('session1', '50');

      expect(capturedData.value).toBe(100);
    });
  });

  describe('Confirmation step', () => {
    it('should show confirmation message', async () => {
      const app = createApp()
        .form('transfer', f => f
          .field('phone', field => field.prompt('Enter phone:'))
          .field('amount', field => field.prompt('Enter amount:'))
          .confirm(ctx =>
            `Send ${ctx.sessionData.amount} to ${ctx.sessionData.phone}?\n1. Yes\n2. No`
          )
          .onConfirm('1').end('Sent!')
          .onCancel('2').end('Cancelled.')
        )
        .start('transfer_phone')
        .build();

      await app.processInput('session1', '');
      await app.processInput('session1', '0712345678');
      const confirmMsg = await app.processInput('session1', '500');

      expect(confirmMsg).toBe('CON Send 500 to 0712345678?\n1. Yes\n2. No');
    });

    it('should handle confirm action', async () => {
      const app = createApp()
        .form('order', f => f
          .field('item', field => field.prompt('Enter item:'))
          .confirm(ctx => `Order ${ctx.sessionData.item}?\n1. Confirm\n2. Cancel`)
          .onConfirm('1').end('Order placed!')
          .onCancel('2').end('Cancelled')
        )
        .start('order_item')
        .build();

      await app.processInput('session1', '');
      await app.processInput('session1', 'Pizza');
      await app.processInput('session1', ''); // Show confirm
      const response = await app.processInput('session1', '1');

      expect(response).toBe('END Order placed!');
    });

    it('should handle cancel action', async () => {
      const app = createApp()
        .form('order', f => f
          .field('item', field => field.prompt('Enter item:'))
          .confirm(ctx => `Order ${ctx.sessionData.item}?\n1. Yes\n2. No`)
          .onConfirm('1').end('Ordered!')
          .onCancel('2').end('Cancelled')
        )
        .start('order_item')
        .build();

      await app.processInput('session1', '');
      await app.processInput('session1', 'Burger');
      await app.processInput('session1', ''); // Show confirm
      const response = await app.processInput('session1', '2');

      expect(response).toBe('END Cancelled');
    });

    it('should support goto in confirm/cancel actions', async () => {
      const app = createApp()
        .form('flow', f => f
          .field('data', field => field.prompt('Enter data:'))
          .confirm(ctx => `Confirm?\n1. Yes\n2. No`)
          .onConfirm('1').goto('success')
          .onCancel('2').goto('retry')
        )
        .state('success', s => s.message('Success!').end())
        .state('retry', s => s.message('Try again').end())
        .start('flow_data')
        .build();

      await app.processInput('session1', '');
      await app.processInput('session1', 'test');
      await app.processInput('session1', ''); // Show confirm
      const response = await app.processInput('session1', '1');

      expect(response).toBe('END Success!');
    });
  });

  describe('Form validation', () => {
    it('should throw error if form has no fields', () => {
      expect(() => {
        createApp()
          .form('empty', f => f)
          .build();
      }).toThrow('Form must have at least one field');
    });

    it('should throw error if field has no prompt', () => {
      expect(() => {
        createApp()
          .form('bad', f => f.field('test', field => field.validate(() => {})))
          .build();
      }).toThrow('Field "test" must have a prompt');
    });
  });

  describe('Multi-field forms', () => {
    it('should handle 3+ fields', async () => {
      let data = null;

      const app = createApp()
        .form('profile', f => f
          .field('name', field => field.prompt('Name:'))
          .field('email', field => field.prompt('Email:'))
          .field('phone', field => field.prompt('Phone:'))
          .field('city', field => field.prompt('City:'))
          .onComplete('summary')
        )
        .state('summary', s => s
          .run(async (input, sid, ctx) => {
            data = ctx.sessionData;
            return 'Profile saved';
          })
          .end()
        )
        .start('profile_name')
        .build();

      await app.processInput('session1', '');
      await app.processInput('session1', 'Jane');
      await app.processInput('session1', 'jane@example.com');
      await app.processInput('session1', '0700000000');
      await app.processInput('session1', 'Nairobi');

      expect(data).toEqual({
        name: 'Jane',
        email: 'jane@example.com',
        phone: '0700000000',
        city: 'Nairobi'
      });
    });

    it('should chain validators correctly', async () => {
      const app = createApp()
        .form('validated', f => f
          .field('email', field => field
            .prompt('Email:')
            .validate(Validators.email())
          )
          .field('phone', field => field
            .prompt('Phone:')
            .validate(Validators.phone({ country: 'KE' }))
          )
          .onComplete('done')
        )
        .state('done', s => s.message('Done').end())
        .start('validated_email')
        .build();

      await app.processInput('session1', '');

      // Invalid email
      let response = await app.processInput('session1', 'not-an-email');
      expect(response).toContain('CON');
      expect(response).toContain('Please try again');

      // Valid email
      response = await app.processInput('session1', 'test@example.com');
      expect(response).toBe('CON Phone:');
    });
  });

  describe('FormBuilder class exports', () => {
    it('should export FormBuilder', () => {
      expect(FormBuilder).toBeDefined();
    });

    it('should export FieldBuilder', () => {
      expect(FieldBuilder).toBeDefined();
    });
  });
});
