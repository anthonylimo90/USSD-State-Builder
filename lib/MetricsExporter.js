/**
 * Metrics Exporter - OpenTelemetry and Prometheus Integration
 *
 * Exports USSD metrics in standard formats for monitoring integration.
 * Supports Prometheus text exposition format and OpenTelemetry-compatible
 * metric structures.
 */

/**
 * Prometheus metrics exporter
 * Exposes metrics in Prometheus text exposition format
 */
class PrometheusExporter {
    /**
     * Create a new PrometheusExporter
     * @param {Object} [options] - Exporter options
     * @param {string} [options.prefix='ussd_'] - Metric name prefix
     * @param {Object} [options.defaultLabels={}] - Default labels for all metrics
     * @param {number} [options.buckets] - Histogram bucket boundaries for response times
     *
     * @example
     * const exporter = new PrometheusExporter({ prefix: 'myapp_ussd_' });
     * const metricsMiddleware = createMetricsMiddleware();
     * // Later, expose metrics endpoint
     * app.get('/metrics', (req, res) => {
     *   res.set('Content-Type', 'text/plain');
     *   res.send(exporter.export(metricsMiddleware.getMetrics()));
     * });
     */
    constructor(options = {}) {
        this.prefix = options.prefix || 'ussd_';
        this.defaultLabels = options.defaultLabels || {};
        this.buckets = options.buckets || [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

        // Internal histogram tracking
        this._histogramBuckets = new Map();
        this._histogramSum = 0;
        this._histogramCount = 0;
    }

    /**
     * Record a response time observation for histogram
     * @param {number} durationMs - Response time in milliseconds
     * @param {Object} [labels={}] - Additional labels
     */
    observe(durationMs, labels = {}) {
        this._histogramSum += durationMs;
        this._histogramCount++;

        const labelKey = this._formatLabels(labels);
        if (!this._histogramBuckets.has(labelKey)) {
            this._histogramBuckets.set(labelKey, {
                labels,
                buckets: new Array(this.buckets.length).fill(0),
                count: 0,
                sum: 0
            });
        }

        const data = this._histogramBuckets.get(labelKey);
        data.count++;
        data.sum += durationMs;

        for (let i = 0; i < this.buckets.length; i++) {
            if (durationMs <= this.buckets[i]) {
                data.buckets[i]++;
            }
        }
    }

    /**
     * Export metrics in Prometheus text exposition format
     * @param {Object} metrics - Metrics from createMetricsMiddleware().getMetrics()
     * @returns {string} Prometheus-formatted metrics text
     *
     * @example
     * const text = exporter.export(machine.getMetrics());
     * // Output:
     * // # HELP ussd_requests_total Total USSD requests processed
     * // # TYPE ussd_requests_total counter
     * // ussd_requests_total 1234
     */
    export(metrics) {
        const lines = [];
        const p = this.prefix;
        const dl = this._formatDefaultLabels();

        // Total requests counter
        lines.push(`# HELP ${p}requests_total Total USSD requests processed`);
        lines.push(`# TYPE ${p}requests_total counter`);
        lines.push(`${p}requests_total${dl} ${metrics.totalRequests || 0}`);
        lines.push('');

        // Total errors counter
        lines.push(`# HELP ${p}errors_total Total USSD errors`);
        lines.push(`# TYPE ${p}errors_total counter`);
        lines.push(`${p}errors_total${dl} ${metrics.totalErrors || 0}`);
        lines.push('');

        // Error rate gauge
        lines.push(`# HELP ${p}error_rate Current error rate percentage`);
        lines.push(`# TYPE ${p}error_rate gauge`);
        const errorRate = metrics.errorRate ? parseFloat(metrics.errorRate) : 0;
        lines.push(`${p}error_rate${dl} ${errorRate}`);
        lines.push('');

        // Average response time gauge
        lines.push(`# HELP ${p}response_time_avg_ms Average response time in milliseconds`);
        lines.push(`# TYPE ${p}response_time_avg_ms gauge`);
        const avgTime = metrics.averageResponseTime ? parseInt(metrics.averageResponseTime) : 0;
        lines.push(`${p}response_time_avg_ms${dl} ${avgTime}`);
        lines.push('');

        // Requests by state
        if (metrics.requestsByState && Object.keys(metrics.requestsByState).length > 0) {
            lines.push(`# HELP ${p}requests_by_state_total Requests per state`);
            lines.push(`# TYPE ${p}requests_by_state_total counter`);
            for (const [state, count] of Object.entries(metrics.requestsByState)) {
                const stateLabel = `state="${this._escapeLabel(state)}"`;
                const labels = dl ? `{${stateLabel},${dl.slice(1, -1)}}` : `{${stateLabel}}`;
                lines.push(`${p}requests_by_state_total${labels} ${count}`);
            }
            lines.push('');
        }

        // Response time histogram
        if (this._histogramCount > 0) {
            lines.push(`# HELP ${p}response_time_ms Response time histogram in milliseconds`);
            lines.push(`# TYPE ${p}response_time_ms histogram`);

            for (const [, data] of this._histogramBuckets) {
                const labels = this._formatLabels(data.labels);
                let cumulativeCount = 0;
                for (let i = 0; i < this.buckets.length; i++) {
                    cumulativeCount += data.buckets[i];
                    const bucketLabel = labels
                        ? `{le="${this.buckets[i]}",${labels.slice(1, -1)}}`
                        : `{le="${this.buckets[i]}"}`;
                    lines.push(`${p}response_time_ms_bucket${bucketLabel} ${cumulativeCount}`);
                }
                const infLabel = labels
                    ? `{le="+Inf",${labels.slice(1, -1)}}`
                    : `{le="+Inf"}`;
                lines.push(`${p}response_time_ms_bucket${infLabel} ${data.count}`);
                lines.push(`${p}response_time_ms_sum${labels || ''} ${data.sum}`);
                lines.push(`${p}response_time_ms_count${labels || ''} ${data.count}`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Reset all histogram data
     */
    reset() {
        this._histogramBuckets.clear();
        this._histogramSum = 0;
        this._histogramCount = 0;
    }

    /**
     * Format labels as Prometheus label string
     * @private
     */
    _formatLabels(labels) {
        const entries = Object.entries(labels || {});
        if (entries.length === 0) return '';
        return '{' + entries.map(([k, v]) => `${k}="${this._escapeLabel(v)}"`).join(',') + '}';
    }

    /**
     * Format default labels
     * @private
     */
    _formatDefaultLabels() {
        const entries = Object.entries(this.defaultLabels);
        if (entries.length === 0) return '';
        return '{' + entries.map(([k, v]) => `${k}="${this._escapeLabel(v)}"`).join(',') + '}';
    }

    /**
     * Escape label value for Prometheus format
     * @private
     */
    _escapeLabel(value) {
        return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    }
}

/**
 * OpenTelemetry-compatible metrics collector
 * Produces metric structures compatible with OpenTelemetry SDK
 */
class OpenTelemetryCollector {
    /**
     * Create a new OpenTelemetryCollector
     * @param {Object} [options] - Collector options
     * @param {string} [options.serviceName='ussd-state-machine'] - Service name
     * @param {string} [options.serviceVersion='1.0.0'] - Service version
     * @param {Object} [options.resourceAttributes={}] - Additional resource attributes
     *
     * @example
     * const collector = new OpenTelemetryCollector({
     *   serviceName: 'my-ussd-app',
     *   serviceVersion: '2.0.0'
     * });
     */
    constructor(options = {}) {
        this.serviceName = options.serviceName || 'ussd-state-machine';
        this.serviceVersion = options.serviceVersion || '1.0.0';
        this.resourceAttributes = options.resourceAttributes || {};

        this._spans = [];
        this._maxSpans = options.maxSpans || 1000;
    }

    /**
     * Record a request span
     * @param {Object} spanData - Span data
     * @param {string} spanData.sessionId - Session ID
     * @param {string} spanData.state - Current state
     * @param {number} spanData.durationMs - Duration in ms
     * @param {string} [spanData.status='ok'] - Span status
     * @param {Object} [spanData.attributes={}] - Additional attributes
     */
    recordSpan(spanData) {
        const span = {
            traceId: this._generateId(32),
            spanId: this._generateId(16),
            name: `ussd.process.${spanData.state || 'unknown'}`,
            kind: 'SERVER',
            startTime: Date.now() - (spanData.durationMs || 0),
            endTime: Date.now(),
            status: spanData.status || 'ok',
            attributes: {
                'ussd.session_id': spanData.sessionId,
                'ussd.state': spanData.state,
                'ussd.duration_ms': spanData.durationMs,
                'service.name': this.serviceName,
                'service.version': this.serviceVersion,
                ...this.resourceAttributes,
                ...(spanData.attributes || {})
            }
        };

        this._spans.push(span);
        if (this._spans.length > this._maxSpans) {
            this._spans.shift();
        }
    }

    /**
     * Export metrics in OpenTelemetry-compatible JSON format
     * @param {Object} metrics - Metrics from createMetricsMiddleware().getMetrics()
     * @returns {Object} OpenTelemetry-compatible metrics object
     */
    export(metrics) {
        return {
            resource: {
                attributes: {
                    'service.name': this.serviceName,
                    'service.version': this.serviceVersion,
                    ...this.resourceAttributes
                }
            },
            scopeMetrics: [{
                scope: {
                    name: 'ussd-state-machine',
                    version: this.serviceVersion
                },
                metrics: [
                    {
                        name: 'ussd.requests.total',
                        description: 'Total USSD requests processed',
                        unit: '1',
                        sum: {
                            dataPoints: [{
                                value: metrics.totalRequests || 0,
                                timeUnixNano: Date.now() * 1000000
                            }],
                            isMonotonic: true,
                            aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE'
                        }
                    },
                    {
                        name: 'ussd.errors.total',
                        description: 'Total USSD errors',
                        unit: '1',
                        sum: {
                            dataPoints: [{
                                value: metrics.totalErrors || 0,
                                timeUnixNano: Date.now() * 1000000
                            }],
                            isMonotonic: true,
                            aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE'
                        }
                    },
                    {
                        name: 'ussd.response_time',
                        description: 'Average response time',
                        unit: 'ms',
                        gauge: {
                            dataPoints: [{
                                value: metrics.averageResponseTime ? parseInt(metrics.averageResponseTime) : 0,
                                timeUnixNano: Date.now() * 1000000
                            }]
                        }
                    }
                ]
            }],
            spans: this._spans.slice(-100) // Last 100 spans
        };
    }

    /**
     * Get recorded spans
     * @param {number} [limit=100] - Maximum spans to return
     * @returns {Object[]} Array of span objects
     */
    getSpans(limit = 100) {
        return this._spans.slice(-limit);
    }

    /**
     * Clear all recorded spans
     */
    clearSpans() {
        this._spans = [];
    }

    /**
     * Generate a random hex ID
     * @private
     */
    _generateId(length) {
        const crypto = require('crypto');
        return crypto.randomBytes(length / 2).toString('hex');
    }
}

/**
 * Create a metrics middleware with export capabilities
 * Wraps the standard metrics middleware with Prometheus and OTEL exporters
 * @param {Object} [options] - Options
 * @param {string} [options.format='prometheus'] - Export format ('prometheus' or 'opentelemetry')
 * @param {Object} [options.prometheus] - PrometheusExporter options
 * @param {Object} [options.opentelemetry] - OpenTelemetryCollector options
 * @param {Object} [options.metrics] - Base metrics middleware options
 * @returns {Object} Enhanced metrics middleware with exporters
 *
 * @example
 * const { middleware, getMetrics, exportMetrics } = createExportableMetrics({
 *   format: 'prometheus',
 *   prometheus: { prefix: 'myapp_ussd_' }
 * });
 *
 * machine.use('afterProcess', middleware);
 *
 * // Express endpoint
 * app.get('/metrics', (req, res) => {
 *   res.set('Content-Type', 'text/plain');
 *   res.send(exportMetrics());
 * });
 */
function createExportableMetrics(options = {}) {
    const { createMetricsMiddleware } = require('./Middleware');
    const baseMetrics = createMetricsMiddleware(options.metrics || {});

    const prometheus = new PrometheusExporter(options.prometheus || {});
    const otel = new OpenTelemetryCollector(options.opentelemetry || {});

    const format = options.format || 'prometheus';

    // Wrap the base middleware to also feed exporters
    const middleware = async (context, next) => {
        const startTime = Date.now();

        await baseMetrics.middleware(context, next);

        const duration = Date.now() - startTime;
        const state = context.currentState || 'unknown';

        // Feed Prometheus histogram
        prometheus.observe(duration, { state });

        // Record OTEL span
        otel.recordSpan({
            sessionId: context.sessionId,
            state,
            durationMs: duration,
            status: context.error ? 'error' : 'ok'
        });
    };

    const exportMetrics = () => {
        const metrics = baseMetrics.getMetrics();
        if (format === 'opentelemetry') {
            return otel.export(metrics);
        }
        return prometheus.export(metrics);
    };

    return {
        middleware,
        getMetrics: baseMetrics.getMetrics,
        resetMetrics: baseMetrics.resetMetrics,
        exportMetrics,
        prometheus,
        opentelemetry: otel
    };
}

module.exports = {
    PrometheusExporter,
    OpenTelemetryCollector,
    createExportableMetrics
};
