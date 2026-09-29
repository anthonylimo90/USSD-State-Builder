const http = require('node:http');
const { createWorkbenchServer, WorkbenchError } = require('..');
const { createDemoWorkbench } = require('../examples/workbench/server');

let app;
let base;
beforeAll(async () => {
  app = createWorkbenchServer({ workbench: createDemoWorkbench() });
  base = (await app.listen(0)).url;
});
afterAll(async () => { await app.close(); });

function request(route, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${route}`, { method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text,
        json: res.headers['content-type'].startsWith('application/json') ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}

test('serves the local workspace and shared keypad with same-origin policy', async () => {
  expect(app.server.address().address).toBe('127.0.0.1');
  const page = await request('/');
  expect(page.status).toBe(200);
  expect(page.text).toContain('USSD Workbench');
  expect(page.headers['content-security-policy']).toContain("script-src 'self'");
  expect((await request('/keypad.js')).text).toContain('attachKeypad');
  expect((await request('/ui.js')).status).toBe(200);
  expect((await request('/graph.js')).text).toContain('renderFlowGraph');
  expect((await request('/style.css')).status).toBe(200);
  const config = await request('/api/workbench');
  expect(config.json.flows.map(flow => flow.id)).toEqual(['sdk-shop', 'traditional-shop', 'diagnostics', 'dynamic']);
  expect((await request('/api/workbench', { headers: { host: 'attacker.example' } })).status).toBe(403);
  expect((await request('/api/workbench', { headers: { origin: 'https://attacker.example' } })).status).toBe(403);
  expect((await request('/api/workbench', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
});

test('HTTP session lifecycle includes validation, state, redaction, isolation and reset', async () => {
  const a = (await request('/api/sessions', { method: 'POST', body: { flowId: 'sdk-shop' } })).json;
  const b = (await request('/api/sessions', { method: 'POST', body: { flowId: 'traditional-shop' } })).json;
  expect(a.analysis).toMatchObject({ coverage: 'complete', valid: true, summary: { states: 4, errors: 0, warnings: 0 } });
  // SDK routes reserve their keys explicitly; traditional handlers need not.
  const structure = analysis => analysis.nodes.map(({ localInputKeys, ...node }) => node);
  expect(structure(b.analysis)).toEqual(structure(a.analysis));
  const turn = input => request(`/api/sessions/${a.id}/turns`, { method: 'POST', body: { input } });
  expect((await turn('')).json.state).toBe('MENU');
  await turn('1');
  expect((await turn('bad')).json.validationError).toBe(true);
  await turn('2');
  const done = await turn('SYNTHETIC_PIN');
  expect(done.json).toMatchObject({ status: 'ended', state: 'DONE', data: { values: { quantity: 2 }, hiddenFields: 1 } });
  expect(done.text).not.toContain('SYNTHETIC_PIN');
  expect((await request(`/api/sessions/${b.id}`)).json.status).toBe('idle');
  expect((await request(`/api/sessions/${a.id}/reset`, { method: 'POST', body: {} })).json.history).toEqual([]);
  expect((await request(`/api/sessions/${a.id}`, { method: 'DELETE' })).status).toBe(200);
  expect((await request(`/api/sessions/${a.id}`)).status).toBe(404);
  await request(`/api/sessions/${b.id}`, { method: 'DELETE' });
});

test('rejects malformed/oversized requests and never returns arbitrary exception details', async () => {
  expect((await request('/api/sessions', { method: 'POST', body: 'invalid' })).status).toBe(400);
  expect((await request('/api/sessions', { method: 'POST', body: 'x'.repeat(1200) })).status).toBe(413);
  expect((await request('/api/sessions', { method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
  expect((await request('/api/sessions', { method: 'POST', body: { sessionId: 'INJECTED', flowId: 'sdk-shop' } })).status).toBe(400);
  const factory = app.workbench.flows.get('sdk-shop').createMachine;
  app.workbench.flows.get('sdk-shop').createMachine = () => { throw new WorkbenchError('SECRET_FACTORY_ERROR', 599); };
  const failed = await request('/api/sessions', { method: 'POST', body: { flowId: 'sdk-shop' } });
  app.workbench.flows.get('sdk-shop').createMachine = factory;
  expect(failed.status).toBe(500);
  expect(failed.text).not.toContain('SECRET_FACTORY_ERROR');
});

test('serves structural diagnostics and treats dynamic uncertainty as information', async () => {
  const broken = (await request('/api/sessions', { method: 'POST', body: { flowId: 'diagnostics' } })).json;
  expect(broken.analysis.valid).toBe(false);
  expect(broken.analysis.diagnostics.map(item => item.type)).toEqual(expect.arrayContaining([
    'MISSING_TARGET', 'CONFLICTING_INPUT', 'NAVIGATION_CONFLICT', 'UNREACHABLE_STATE', 'DEAD_END'
  ]));
  const dynamic = (await request('/api/sessions', { method: 'POST', body: { flowId: 'dynamic' } })).json;
  expect(dynamic.analysis).toMatchObject({ valid: true, coverage: 'partial', summary: { errors: 0, warnings: 0 } });
  expect(dynamic.analysis.nodes.find(node => node.id === 'DONE').reachability).toBe('unknown');
  await request(`/api/sessions/${broken.id}`, { method: 'DELETE' });
  await request(`/api/sessions/${dynamic.id}`, { method: 'DELETE' });
});
