const { LocalWorkbench, createWorkbenchServer, exportReplayTest } = require('ussd-state-builder');
const { createMachine, createHandsetMachine, responses } = require('./flow');
const fixture = require('./scenario.json');

const reference = { modulePath: '../examples/workbench/onboarding/flow', factoryExport: 'createMachine', responsesExport: 'responses' };
function createOnboardingWorkbench() {
  return new LocalWorkbench({ flows: [{ id: 'stock', name: 'Your stock flow', createMachine: createHandsetMachine,
    replay: { createMachine, responses, ...reference } }] });
}

if (require.main === module) {
  if (process.argv.includes('--export')) process.stdout.write(exportReplayTest(fixture, reference));
  else (async () => {
    const app = createWorkbenchServer({ workbench: createOnboardingWorkbench() });
    const { url } = await app.listen(Number(process.env.PORT || 3201));
    console.log(`Onboarding workbench: ${url}\nWalkthrough: docs/WORKBENCH-QUICKSTART.md\nSynthetic teaching flow: the stock check is intentionally broken.`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      app.close().then(() => process.exit(0)).catch(() => { process.exitCode = 1; });
    });
  })().catch(error => { console.error('Onboarding startup failed:', error.message); process.exitCode = 1; });
}

module.exports = { createOnboardingWorkbench };
