// Synthetic, in-process demonstration. No external exporter, provider or customer data.
const assert = require('node:assert/strict');
const { MetricEventBuffer } = require('../..');
const fixture = require('./cohort.json');
let now = Date.parse(fixture.asOf);
const reports = [];
const buffer = new MetricEventBuffer({
  flowVersions: ['mavuno-v1'], states: ['START', 'MENU', 'QUANTITY', 'DONE'],
  retentionMs: 20000, inactivityMs: fixture.inactivityMs, now: () => now,
  exporter: (snapshot, controls) => {
    if (controls.isCurrent()) reports.push(snapshot.report);
  }
});
async function main() {
  fixture.events.forEach(event => buffer.record(event));
  await buffer.flush();
  assert.equal(reports.at(-1).summary.sessions.total, 6);
  console.log('Initial cohort: 6 sessions');
  const sessionId = fixture.events[0].sessionId;
  assert.ok(buffer.deleteSession(sessionId).deletedEvents > 0);
  await buffer.flush();
  assert.equal(reports.at(-1).summary.sessions.total, 5);
  assert.equal(buffer.snapshot().events.some(event => event.sessionId === sessionId), false);
  console.log('Local session deletion: 5 sessions; erased evidence is absent');
  now += 20000;
  await buffer.flush();
  assert.equal(reports.at(-1).summary.sessions.total, 0);
  assert.equal(buffer.stats().events, 0);
  console.log('Retention boundary: 0 sessions; whole cohorts expired');
  buffer.close();
  assert.equal(buffer.record(fixture.events[0]).reason, 'closed');
  console.log('Closed buffer refuses ingestion');
}
main().catch(() => { buffer.close(); console.error('Retention demonstration failed'); process.exitCode = 1; });
