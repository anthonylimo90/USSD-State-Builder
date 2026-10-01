const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { buildMetricReport, selectMetricEvidence, exportMetricReportPrometheus } = require('../../lib/MetricReporting');
const { scenario } = require('./scenarios');
function createMetricsDemoServer() {
  return http.createServer((request, response) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" };
    const send = (status, type, body) => { response.writeHead(status, { ...headers, 'Content-Type': type }); response.end(body); };
    if (request.method !== 'GET') return send(405, 'text/plain', 'Method not allowed');
    const url = new URL(request.url, 'http://localhost');
    const asset = { '/': ['index.html', 'text/html; charset=utf-8'], '/ui.js': ['ui.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] }[url.pathname];
    if (asset) return send(200, asset[1], fs.readFileSync(path.join(__dirname, asset[0])));
    if (!['/api/report', '/api/evidence', '/metrics'].includes(url.pathname)) return send(404, 'text/plain', 'Not found');
    try {
      const data = scenario(url.searchParams.get('scenario') || 'baseline');
      if (url.pathname === '/metrics') return send(200, 'text/plain; version=0.0.4; charset=utf-8', exportMetricReportPrometheus(data.events, data.options));
      const filter = {};
      for (const field of ['flowVersion', 'state']) if (url.searchParams.has(field)) filter[field] = url.searchParams.get(field) === '__unknown__' ? null : url.searchParams.get(field);
      const value = url.pathname === '/api/report' ? { provenance: data.provenance, ...buildMetricReport(data.events, data.options) } : selectMetricEvidence(data.events, data.options, filter);
      return send(200, 'application/json; charset=utf-8', JSON.stringify(value));
    } catch { return send(400, 'application/json', JSON.stringify({ error: 'Invalid metric request' })); }
  });
}
if (require.main === module) {
  const server = createMetricsDemoServer();
  const port = Number(process.env.PORT || 3202);
  server.listen(port, '127.0.0.1', () => console.log(`Synthetic metrics dashboard: http://127.0.0.1:${port}`));
}
module.exports = { createMetricsDemoServer };
