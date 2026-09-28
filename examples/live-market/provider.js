const { TurnGateway, RedisTurnStore, ProviderRequestError } = require('ussd-state-builder');

function createProviderGateway({ adapter, machine, storage, normalizePhone }) {
  return new TurnGateway({ adapter, machine, store: new RedisTurnStore({ storage }),
    sessionData: turn => {
      const phone = normalizePhone(turn.phoneNumber);
      if (!phone) throw new ProviderRequestError('UNSUPPORTED_CALLER');
      return { phone };
    }
  });
}
module.exports = { createProviderGateway };
