import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { scenario } = require('../examples/metrics/scenarios');
const { exportMetricReportPrometheus } = require('../lib/MetricReporting');
for (const name of ['baseline', 'late-provider', 'late-completion', 'latency', 'empty']) {
  const data = scenario(name === 'empty' ? 'baseline' : name);
  const text = exportMetricReportPrometheus(name === 'empty' ? [] : data.events, data.options);
  execFileSync('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'promtool', '-i', 'prom/prometheus:v3.5.0', 'check', 'metrics'],
    { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  console.log(`promtool accepted ${name} cohort`);
}
