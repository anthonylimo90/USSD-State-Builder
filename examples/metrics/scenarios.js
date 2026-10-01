const fixture = require('./cohort.json');
const uuid = number => `00000000-0000-8000-8000-${number.toString(16).padStart(12, '0')}`;
const at = ms => new Date(Date.parse('2026-10-01T00:00:00.000Z') + ms).toISOString();
function scenario(name = 'baseline') {
  const options = { asOf: fixture.asOf, inactivityMs: fixture.inactivityMs };
  const events = fixture.events.map(value => ({ ...value }));
  if (name === 'late-provider' || name === 'late-completion') events.push({ eventType: name === 'late-provider' ? 'provider_end' : 'session_end',
    eventId: uuid(9000), sessionId: fixture.events[3].sessionId, occurredAt: at(1000), flowVersion: 'mavuno-v1', outcome: name === 'late-provider' ? 'Incomplete' : 'completed' });
  else if (name === 'latency') {
    for (let index = 1; index <= 1000; index++) {
      const sessionId = uuid(10000 + index);
      const common = { sessionId, flowVersion: 'latency-v1' };
      events.push({ ...common, eventType: 'session_start', eventId: uuid(20000 + index), occurredAt: at(index) });
      events.push({ ...common, eventType: 'turn', eventId: uuid(30000 + index), turnId: uuid(40000 + index), position: 0,
        occurredAt: at(index + 1000), previousState: 'MEASURE', nextState: null, outcome: 'success', durationMs: index, errorClass: null });
      events.push({ ...common, eventType: 'session_end', eventId: uuid(50000 + index), occurredAt: at(index + 1000), outcome: 'completed' });
    }
  } else if (name !== 'baseline') throw new TypeError('Unknown metric scenario');
  return { provenance: 'synthetic', name, events, options };
}
module.exports = { scenario };
