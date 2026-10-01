const http = require('node:http');
const { createMetricsDemoServer } = require('../examples/metrics/server');
const { scenario } = require('../examples/metrics/scenarios');
const golden = require('./fixtures/metrics/synthetic-cohort.json');
let server, port;
function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    http.request({ hostname: '127.0.0.1', port, path, method }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject).end();
  });
}
beforeAll(async () => { server = createMetricsDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port; });
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
test('published example cohort matches the independently tested golden evidence', () => expect(scenario().events).toEqual(golden.events));
test('dashboard and assets are local, accessible and include explicit uncertainty', async () => {
  const response = await request('/');
  expect(response.status).toBe(200); expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  expect(response.body).toContain('Synthetic evidence'); expect(response.body).toContain('Skip to report'); expect(response.body).toContain('Unknown exits');
  for (const asset of ['/ui.js', '/style.css']) expect((await request(asset)).status).toBe(200);
});
test('JSON and Prometheus routes share the known cohort and late corrections', async () => {
  const baseline = JSON.parse((await request('/api/report')).body);
  expect(baseline.provenance).toBe('synthetic'); expect(baseline.summary.sessions.total).toBe(6);
  const late = JSON.parse((await request('/api/report?scenario=late-provider')).body);
  expect(late.summary.sessions.outcomes).toMatchObject({ abandoned: 0, unknown: 2 });
  const prom = await request('/metrics?scenario=late-provider');
  expect(prom.headers['content-type']).toContain('version=0.0.4');
  expect(prom.body).toContain('ussd_cohort_sessions{flow_version="mavuno-v1",outcome="unknown"} 2');
});
test('large latency scenario, filtered evidence and safe request errors work over HTTP', async () => {
  const large = JSON.parse((await request('/api/report?scenario=latency')).body);
  expect(large.flows.find(value => value.flowVersion === 'latency-v1').latency.p99.value).toBe(990);
  const evidence = JSON.parse((await request('/api/evidence?flowVersion=mavuno-v1&state=MENU')).body);
  expect(evidence.total).toBe(3);
  expect((await request('/api/report?scenario=private-secret')).body).not.toContain('private-secret');
  expect((await request('/api/report?scenario=private-secret')).status).toBe(400);
  expect((await request('/missing')).status).toBe(404);
  expect((await request('/api/report', 'POST')).status).toBe(405);
});
