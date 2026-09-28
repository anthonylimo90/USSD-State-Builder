const { ProviderRequestError } = require('ussd-state-builder');

// Demonstration sequencing guard only. P2-04 will replace this separate cursor
// write with atomic turn receipts; uncertain turns are never rerun here.
function createProviderTurnHandler({ adapter, machine, storage, lockedStorage, normalizePhone }) {
  return turn => {
    const bindingKey = `provider-binding:${turn.sessionKey}`;
    return lockedStorage.withSessionLock(bindingKey, async () => {
      const record = await storage.getData(bindingKey);
      const binding = adapter.bindSession(turn, record?.binding);
      if (record?.pending) throw new ProviderRequestError('UNCERTAIN_TURN', 503);
      const relation = adapter.compareTranscript(turn, record?.transcript);
      if (relation !== 'initial' && relation !== 'next') throw new ProviderRequestError('TRANSCRIPT_CONFLICT', 409);
      const state = await machine.getCurrentState(turn.sessionKey);
      if ((record && !state) || (!record && state)) throw new ProviderRequestError('SESSION_EXPIRED_OR_UNBOUND', 409);
      const phone = normalizePhone(turn.phoneNumber);
      if (!phone) throw new ProviderRequestError('UNSUPPORTED_CALLER');
      await storage.setData(bindingKey, { binding, pending: true }, machine.timeout);
      await machine.setSessionData(turn.sessionKey, { phone });
      const response = await machine.processInput(turn.sessionKey, turn.input);
      // An invalid output also leaves an uncertain cursor; do not advance and retry effects.
      adapter.formatResponse(response);
      await storage.setData(bindingKey, { binding, transcript: turn.transcript, pending: false }, machine.timeout);
      return response;
    });
  };
}

module.exports = { createProviderTurnHandler };
