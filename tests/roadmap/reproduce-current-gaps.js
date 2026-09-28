// Focused, dependency-free acceptance probes for the roadmap's initial defects.
// Run one case with: node tests/roadmap/reproduce-current-gaps.js R1
// An assertion failure means that the named defect is still present.
const assert = require('assert').strict;
const { createApp, PrometheusExporter, FlowDiagram } = require('../..');

const cases = {
  async R1() {
    let reads = 0;
    const app = createApp()
      .state('home', s => s.message('Home').on('1').goto('items'))
      .state('items', s => s
        .dynamicMenu(async () => (++reads === 1 ? ['Shown A'] : ['Changed B']))
        .save('selected')
        .next('done'))
      .state('done', s => s.run((input, sid, ctx) => `Selected ${ctx.sessionData.selected}`).end())
      .logger(null)
      .build();

    assert.equal(await app.processInput('roadmap-r1', ''), 'CON Home');
    assert.match(await app.processInput('roadmap-r1', '1'), /Shown A/);
    assert.equal(await app.processInput('roadmap-r1', '1'), 'END Selected Shown A');
    assert.equal(reads, 1, 'selection must use the displayed snapshot');
  },

  async R2() {
    const events = [];
    const app = createApp()
      .state('home', s => s.message('Home')
        .onEnter(() => events.push('enter home'))
        .onExit(() => events.push('exit home'))
        .on('1').goto('done'))
      .state('done', s => s.message('Done').onEnter(() => events.push('enter done')).end())
      .logger(null)
      .build();
    for (const hook of ['onSessionStart', 'onStateChange', 'onSessionEnd']) {
      app.use(hook, async (ctx, next) => {
        events.push(hook);
        if (next) await next();
      });
    }

    await app.processInput('roadmap-r2', '');
    await app.processInput('roadmap-r2', '1');
    await app.endSession('roadmap-r2');
    for (const name of ['enter home', 'exit home', 'enter done',
      'onSessionStart', 'onStateChange', 'onSessionEnd']) {
      assert.ok(events.includes(name), `missing ${name}: ${events.join(', ')}`);
    }
  },

  async R3() {
    let reads = 0;
    const app = createApp()
      .state('home', s => s.message('Home').on('1').goto('items'))
      .state('items', s => s.dynamicMenu(async () => [`Version ${++reads}`], { refresh: {} }))
      .logger(null)
      .build();

    await app.processInput('roadmap-r3', '');
    assert.match(await app.processInput('roadmap-r3', '1'), /0\. Refresh/);
    assert.match(await app.processInput('roadmap-r3', '0'), /Version 2/);
    assert.equal(await app.getCurrentState('roadmap-r3'), 'items');
  },

  async R5() {
    const app = createApp().state('home', s => s.message('Home').on('1').goto('done'))
      .state('done', s => s.message('Done').end()).build();
    for (const state of Object.values(app.states)) state.handler.toString = () => { throw new Error('Source inspection'); };
    assert.match(new FlowDiagram(app).toMermaid(), /home --> done : 1/);
  },

  async R4() {
    const exporter = new PrometheusExporter({ buckets: [5, 10, 25] });
    exporter.observe(3);
    const output = exporter.export({});
    for (const bound of ['5', '10', '25', '+Inf']) {
      assert.ok(output.split('\n').includes(`ussd_response_time_ms_bucket{le="${bound}"} 1`),
        `incorrect bucket ${bound}: ${output}`);
    }
    assert.match(output, /ussd_response_time_ms_count 1/);
  }
};

async function main() {
  const id = process.argv[2];
  if (!cases[id]) {
    throw new Error(`Specify one of: ${Object.keys(cases).join(', ')}`);
  }
  await cases[id]();
  process.stdout.write(`${id} passed\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
