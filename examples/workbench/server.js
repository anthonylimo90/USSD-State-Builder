const { LocalWorkbench, createWorkbenchServer } = require('ussd-state-builder');
const { createSdkFlow, createTraditionalFlow } = require('./flows');
const { createDiagnosticsFixture, createDynamicFixture } = require('./diagnostics');

function createDemoWorkbench() {
  return new LocalWorkbench({ flows: [
    { id: 'sdk-shop', name: 'Demo shop · SDK', createMachine: createSdkFlow },
    { id: 'traditional-shop', name: 'Demo shop · traditional', createMachine: createTraditionalFlow },
    { id: 'diagnostics', name: 'Diagnostics fixture', createMachine: createDiagnosticsFixture },
    { id: 'dynamic', name: 'Dynamic fixture', createMachine: createDynamicFixture }
  ] });
}

if (require.main === module) {
  (async () => {
    const workbench = createDemoWorkbench();
    if (process.argv.includes('--cli')) {
      const session = await workbench.createSession();
      try { await workbench.getSimulator(session.id, { showDebug: true }).startInteractive(); }
      finally { await workbench.close(); }
      return;
    }
    const app = createWorkbenchServer({ workbench });
    const { url } = await app.listen(Number(process.env.PORT || 3200));
    console.log(`USSD workbench: ${url}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      app.close().then(() => process.exit(0)).catch(() => { process.exitCode = 1; });
    });
  })().catch(error => { console.error('Workbench startup failed:', error.message); process.exitCode = 1; });
}

module.exports = { createDemoWorkbench };
