const { TurnGateway, RedisTurnStore, ProviderRequestError } = require('ussd-state-builder');

function createProviderGateway({ adapter, machine, storage, normalizePhone, market, eventStore, deadlineMs = 5000 }) {
  return new TurnGateway({ adapter, machine, store: new RedisTurnStore({ storage }), eventStore, deadlineMs,
    recoverTurn: async ({ pending, session, signal }) => {
      signal.throwIfAborted();
      const result = session && await market.readOperation(pending.idempotencyKey, session.state, session.data?.phone);
      signal.throwIfAborted();
      if (!result) return null;
      let response;
      if (session.state === 'CONFIRM') {
        response = result.status === 'cancelled' ? `END Order ${result.id} was cancelled. Start a new session to order again.` : `END Order ${result.id} placed. KES ${result.total}. Pickup: ${session.data.pickup}. Demo only.`;
      } else if (session.state === 'ORDER_DETAIL') {
        response = `END ${result.status === 'cancelled' ? `Order ${session.data.viewOrderId} cancelled.` : 'Order could not be cancelled.'}`;
      } else return null;
      return { response, session: { ...session, expiresAt: Date.now() + machine.timeout * 1000 } };
    },
    sessionData: turn => {
      const phone = normalizePhone(turn.phoneNumber);
      if (!phone) throw new ProviderRequestError('UNSUPPORTED_CALLER');
      return { phone };
    }
  });
}
module.exports = { createProviderGateway };
