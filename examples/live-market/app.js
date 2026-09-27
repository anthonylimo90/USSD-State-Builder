const { createApp, Validators } = require('ussd-state-builder');
const { CATALOG, PRODUCTS } = require('./catalog');

const MAIN_MENU = 'CON Mavuno Co-op (demo)\n1 Shop\n2 Cart\n3 My orders\n4 Help';
const CATEGORY_MENU = 'CON Choose a category\n1 Seeds\n2 Soil care\n3 Tools\n0 Back';
const PICKUP_MENU = 'CON Pickup window\n1 Today 16:00-18:00\n2 Tomorrow 09:00-11:00\n0 Back';

function cartTotal(cart) {
  return Object.entries(cart || {}).reduce(
    (sum, [sku, quantity]) => sum + (PRODUCTS[sku]?.price || 0) * quantity, 0
  );
}

function cartResponse(cart) {
  const lines = Object.entries(cart || {}).map(([sku, quantity]) =>
    `${PRODUCTS[sku].name} x${quantity}`
  );
  return `CON ${lines.length ? lines.join('\n') : 'Cart is empty'}\nTotal KES ${cartTotal(cart)}\n1 Add 2 Checkout 3 Clear\n0 Back`;
}

function createMarketApp({ storage, market }) {
  return createApp()
    .state('MENU', s => s
      .message(MAIN_MENU.slice(4))
      .run(input => input ? `Invalid choice\n${MAIN_MENU.slice(4)}` : undefined)
      .on('1').goto('CATEGORY')
      .on('2').goto('CART')
      .on('3').goto('ORDER_CODE')
      .on('4').end('Demo orders only. No real purchases are made.'))

    .state('CATEGORY', s => s.run(async input => {
        if (!input) return { response: CATEGORY_MENU };
        const category = { '1': 'seeds', '2': 'soil', '3': 'tools' }[input];
        if (!category) return { response: `CON Invalid choice\n${CATEGORY_MENU.slice(4)}` };
        const products = CATALOG[category];
        const lines = await Promise.all(products.map(async (product, index) =>
          `${index + 1} ${product.name} KES ${product.price} (${await market.getStock(product.sku)} left)`
        ));
        return {
          response: `CON ${lines.join('\n')}\n0 Back`,
          nextState: 'ITEM',
          data: { category }
        };
      }))

    .state('ITEM', s => s.run(async (input, sessionId, context) => {
        const products = CATALOG[context.sessionData?.category] || [];
        const lines = await Promise.all(products.map(async (product, index) =>
          `${index + 1} ${product.name} KES ${product.price} (${await market.getStock(product.sku)} left)`
        ));
        if (!input) return { response: `CON ${lines.join('\n')}\n0 Back` };
        const product = products[Number(input) - 1];
        if (!product || !/^[1-9]$/.test(input)) {
          return { response: `CON Invalid item\n${lines.join('\n')}\n0 Back` };
        }
        if (await market.getStock(product.sku) < 1) {
          return { response: `CON ${product.name} is out of stock\n${lines.join('\n')}\n0 Back` };
        }
        return {
          response: `CON ${product.name}\nQuantity (1-9)?\n0 Back`,
          nextState: 'QUANTITY',
          data: { selectedSku: product.sku }
        };
      }))

    .state('QUANTITY', s => s
      .validate(async input => {
        await Validators.required('Enter a quantity from 1 to 9')(input);
        await Validators.pattern({ pattern: /^[1-9]$/, message: 'Enter a quantity from 1 to 9' })(input);
      })
      .run(async (input, sessionId, context) => {
        const data = context.sessionData || {};
        const product = PRODUCTS[data.selectedSku];
        if (!input) return { response: `CON ${product.name}\nQuantity (1-9)?\n0 Back` };
        const quantity = Number(input);
        const available = await market.getStock(product.sku);
        if (available === 0) {
          return { response: 'CON Sold out. Choose another item.\n0 Back', nextState: 'ITEM' };
        }
        if (quantity > available) {
          return { response: `CON Only ${available} available. Enter 1-${Math.min(available, 9)}\n0 Back` };
        }
        const cart = { ...(data.cart || {}), [product.sku]: quantity };
        return {
          response: `CON Added ${product.name} x${quantity}\n1 Add item\n2 View cart\n3 Checkout\n0 Back`,
          nextState: 'CART_ACTION',
          data: { cart }
        };
      }))

    .state('CART_ACTION', s => s.run(async (input, sessionId, context) => {
        if (!input) return { response: 'CON 1 Add item\n2 View cart\n3 Checkout\n0 Back' };
        if (input === '1') return { response: CATEGORY_MENU, nextState: 'CATEGORY' };
        if (input === '2') return { response: cartResponse(context.sessionData?.cart), nextState: 'CART' };
        if (input === '3') return { response: PICKUP_MENU, nextState: 'PICKUP' };
        return { response: 'CON Invalid choice\n1 Add item\n2 View cart\n3 Checkout\n0 Back' };
      }))

    .state('CART', s => s.run(async (input, sessionId, context) => {
        const cart = context.sessionData?.cart || {};
        if (!input) return { response: cartResponse(cart) };
        if (input === '1') return { response: CATEGORY_MENU, nextState: 'CATEGORY' };
        if (input === '2') {
          if (!Object.keys(cart).length) return { response: 'CON Add an item first\n1 Add\n0 Back' };
          return { response: PICKUP_MENU, nextState: 'PICKUP' };
        }
        if (input === '3') return { response: MAIN_MENU, nextState: 'MENU', data: { cart: {} } };
        return { response: `CON Invalid choice\n${cartResponse(cart).slice(4)}` };
      }))

    .state('PICKUP', s => s.run(async (input, sessionId, context) => {
        if (!input) return { response: PICKUP_MENU };
        const pickup = { '1': 'Today 16:00-18:00', '2': 'Tomorrow 09:00-11:00' }[input];
        if (!pickup) return { response: `CON Invalid choice\n${PICKUP_MENU.slice(4)}` };
        return {
          response: `CON Total KES ${cartTotal(context.sessionData?.cart)}\n${pickup}\n1 Place order\n2 Cancel\n0 Back`,
          nextState: 'CONFIRM',
          data: { pickup }
        };
      }))

    .state('CONFIRM', s => s.run(async (input, sessionId, context) => {
        const data = context.sessionData || {};
        if (!input) return {
          response: `CON Total KES ${cartTotal(data.cart)}\n${data.pickup}\n1 Place order\n2 Cancel\n0 Back`
        };
        if (input === '2') return { response: 'END Order cancelled. Nothing was reserved.' };
        if (input !== '1') return { response: 'CON Invalid choice\n1 Place order\n2 Cancel\n0 Back' };
        const result = await market.placeOrder(sessionId, data.phone, data.cart, data.pickup);
        if (result.status === 'out_of_stock') {
          return {
            response: `CON ${PRODUCTS[result.sku].name}: ${result.available} left. Edit cart.\n1 Add 2 Checkout 3 Clear\n0 Back`,
            nextState: 'CART'
          };
        }
        if (result.status === 'cancelled') {
          return { response: `END Order ${result.id} was cancelled. Start a new session to order again.` };
        }
        return { response: `END Order ${result.id} placed. KES ${result.total}. Pickup: ${data.pickup}. Demo only.` };
      }))

    .state('ORDER_CODE', s => s.run(async (input, sessionId, context) => {
        if (!input) {
          const orders = await market.listOrders(context.sessionData?.phone);
          const list = orders.map(order => `${order.id} ${order.status}`).join('\n');
          return { response: `CON ${list || 'No orders yet'}\nEnter an order number\n0 Back` };
        }
        const id = /^M?\d{1,5}$/i.test(input) ? `M${input.replace(/^M/i, '').padStart(5, '0')}` : null;
        const order = id && await market.getOrder(id, context.sessionData?.phone);
        if (!order) return { response: 'CON Order not found\nEnter another number\n0 Back' };
        return {
          response: `CON ${order.id}: ${order.status}\nKES ${order.total}, ${order.pickup}\n1 Cancel order\n2 Done\n0 Back`,
          nextState: 'ORDER_DETAIL',
          data: { viewOrderId: id }
        };
      }))

    .state('ORDER_DETAIL', s => s.run(async (input, sessionId, context) => {
        const data = context.sessionData || {};
        const order = await market.getOrder(data.viewOrderId, data.phone);
        if (!order) return { response: 'END Order not found' };
        if (!input) return {
          response: `CON ${order.id}: ${order.status}\nKES ${order.total}, ${order.pickup}\n1 Cancel order\n2 Done\n0 Back`
        };
        if (input === '2') return { response: 'END Thank you for using Mavuno Co-op.' };
        if (input !== '1') return { response: 'CON Invalid choice\n1 Cancel order\n2 Done\n0 Back' };
        const result = await market.cancelOrder(order.id, data.phone);
        return { response: `END ${result === 'cancelled' ? `Order ${order.id} cancelled.` : 'Order could not be cancelled.'}` };
      }))
    .start('MENU')
    .storage(storage)
    .timeout(300)
    .backNavigation(true)
    .logger(null)
    .build();
}

module.exports = { createMarketApp, cartTotal };
