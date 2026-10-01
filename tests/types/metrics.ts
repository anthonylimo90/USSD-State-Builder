import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { MetricEventBuffer, createMetricOtelBridge, buildMetricReport, exportMetricReportPrometheus } from '../../types/index';
const meter = new MeterProvider().getMeter('typed-metric-consumer');
const bridge = createMetricOtelBridge(meter);
const options = { asOf: '2026-10-01T00:00:00.000Z' };
bridge.update([], options);
bridge.close();
const report = buildMetricReport([], options);
const text: string = exportMetricReportPrometheus([], options);
void [report.latency.p95.value, report.states[0]?.observedDropOffRate, text];

const buffer = new MetricEventBuffer({ flowVersions: ['v1'], states: ['START'],
  exporter: (snapshot, controls) => {
    if (controls.isCurrent() && !controls.signal.aborted) bridge.update([...snapshot.events], snapshot.options);
  }, onFailure: failure => { const code: string = failure.code; void code; } });
const bufferedEvents: number = buffer.stats().events;
void bufferedEvents;
void buffer.flush();
buffer.close();
