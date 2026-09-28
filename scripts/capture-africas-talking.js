const fs = require('node:fs');
const path = require('node:path');
const { createCaptureServer } = require('./lib/sandbox-capture');

const output = path.resolve(process.env.CAPTURE_FILE || '/private/tmp/ussd-sandbox-capture.jsonl');
const port = Number(process.env.PORT || 3101);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
// Exclusive creation prevents mixing evidence from separate runs.
const file = fs.openSync(output, 'wx', 0o600);
const server = createCaptureServer({ record: evidence => fs.writeSync(file, `${JSON.stringify(evidence)}\n`) });
server.on('error', () => {
  fs.closeSync(file);
  console.error('Capture server could not start. Check PORT and CAPTURE_FILE.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Sandbox evidence probe: http://127.0.0.1:${port}`);
  console.log(`Sanitized evidence: ${output}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => {
    fs.closeSync(file);
    console.log(`Capture totals: ${JSON.stringify(server.getCaptureStats())}`);
  }));
}
