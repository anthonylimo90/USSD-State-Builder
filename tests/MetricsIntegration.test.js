const { createApp, PrometheusExporter, ValidationError, USSDStateMachine, createMetricsMiddleware } = require('..');

describe('metrics across complete turns', () => {
  test('counts success, back navigation, validation, thrown errors, blocked requests, and replay once each', async () => {
    const app = createApp()
      .state('home', s => s.message('Home').on('1').goto('input'))
      .state('input', s => s
        .validate(input => {
          if (input === 'bad') throw new ValidationError('Invalid choice');
        })
        .run(input => {
          if (input === 'explode') throw new Error('Downstream failure');
          if (input === 'done') return { response: 'END Done' };
          return 'Input';
        }))
      .metrics()
      .logger(null)
      .build();
    app.use('beforeProcess', async (ctx, next) => {
      if (ctx.input === 'block') {
        ctx.blocked = true;
        ctx.response = 'END Blocked';
        return;
      }
      await next();
    });

    await app.processInput('metric-turn', '');
    await app.processInput('metric-turn', '1');
    await app.processInput('metric-turn', 'bad');
    await expect(app.processInput('metric-turn', 'explode')).rejects.toThrow('Downstream failure');
    await app.processInput('metric-turn', '0');
    await app.processInput('metric-turn', 'block');
    await app.processInput('metric-turn', '1');
    await app.processInput('metric-turn', 'done');
    await app.processInput('metric-turn', 'done');

    const metrics = app.getMetrics();
    expect(metrics.totalRequests).toBe(9);
    expect(metrics.totalErrors).toBe(2);
    expect(metrics.requestsByState).toEqual({ home: 4, input: 5 });
    expect(metrics.outcomes).toEqual({ success: 5, validation_error: 1, error: 1, blocked: 1, replay: 1 });
    expect(metrics.averageResponseTime).toMatch(/^\d+ms$/);
  });

  test('measures time spent in the handler, not just afterProcess', async () => {
    const app = createApp()
      .state('slow', s => s.run(async () => {
        await new Promise(resolve => setTimeout(resolve, 25));
        return 'Done';
      }).end())
      .metrics()
      .logger(null)
      .build();

    await app.processInput('slow-turn', '');
    expect(Number.parseInt(app.getMetrics().averageResponseTime, 10)).toBeGreaterThanOrEqual(20);
  });

  test('traditional API can observe a full turn without changing its response', async () => {
    const metrics = createMetricsMiddleware();
    const app = new USSDStateMachine({
      initialState: 'HOME',
      states: { HOME: { handler: () => ({ response: 'CON Home' }) } },
      logger: { error: jest.fn() }
    });
    app.useTurnObserver(() => { throw new Error('observability outage'); });
    app.useTurnObserver(metrics.observeTurn);

    expect(await app.processInput('traditional-metrics', '')).toBe('CON Home');
    expect(metrics.getMetrics().totalRequests).toBe(1);
    expect(app.logger.error).toHaveBeenCalled();
  });

  test('exports each Prometheus histogram bucket as the cumulative number of observations', () => {
    const exporter = new PrometheusExporter({ buckets: [5, 10, 25] });
    exporter.observe(3, { route: 'menu' });
    exporter.observe(17, { route: 'menu' });
    const output = exporter.export({});
    expect(output).toContain('ussd_response_time_ms_bucket{le="5",route="menu"} 1');
    expect(output).toContain('ussd_response_time_ms_bucket{le="10",route="menu"} 1');
    expect(output).toContain('ussd_response_time_ms_bucket{le="25",route="menu"} 2');
    expect(output).toContain('ussd_response_time_ms_bucket{le="+Inf",route="menu"} 2');
    expect(output).toContain('ussd_response_time_ms_count{route="menu"} 2');
  });
});
