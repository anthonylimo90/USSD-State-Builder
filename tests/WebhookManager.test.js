const { WebhookManager } = require('../lib/WebhookManager');

describe('WebhookManager', () => {
    let manager;

    beforeEach(() => {
        manager = new WebhookManager({ defaultTimeout: 5000 });
    });

    afterEach(() => {
        manager.destroy();
    });

    test('should register a webhook', async () => {
        const result = await manager.register('session-1', {
            type: 'payment',
            resumeState: 'payment_result'
        });

        expect(result.webhookId).toBeDefined();
        expect(result.secret).toBeDefined();
        expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    test('should receive a webhook', async () => {
        const reg = await manager.register('session-1', { type: 'otp' });

        const result = await manager.receive(reg.webhookId, { code: '123456' }, reg.secret);

        expect(result.success).toBe(true);
        expect(result.sessionId).toBe('session-1');
        expect(result.payload.code).toBe('123456');
    });

    test('should verify webhook secret', async () => {
        const reg = await manager.register('session-1');

        const badResult = await manager.receive(reg.webhookId, {}, 'wrong-secret');
        expect(badResult.success).toBe(false);
        expect(badResult.error).toContain('Invalid');

        const missingResult = await manager.receive(reg.webhookId, {});
        expect(missingResult.success).toBe(false);

        const goodResult = await manager.receive(reg.webhookId, {}, reg.secret);
        expect(goodResult.success).toBe(true);
    });

    test('should reject duplicate receives', async () => {
        const reg = await manager.register('session-1');

        await manager.receive(reg.webhookId, { first: true }, reg.secret);
        const second = await manager.receive(reg.webhookId, { second: true }, reg.secret);
        expect(second.success).toBe(false);
        expect(second.error).toContain('already');
    });

    test('should cancel a webhook', async () => {
        const reg = await manager.register('session-1');
        const cancelled = await manager.cancel(reg.webhookId);
        expect(cancelled).toBe(true);

        const result = await manager.receive(reg.webhookId, {});
        expect(result.success).toBe(false);
    });

    test('should return status', async () => {
        const reg = await manager.register('session-1', { type: 'test' });
        const status = await manager.getStatus(reg.webhookId);

        expect(status.status).toBe('pending');
        expect(status.type).toBe('test');
    });

    test('should handle timeout', async () => {
        let timedOut = false;
        const mgr = new WebhookManager({
            defaultTimeout: 200,
            onTimeout: () => { timedOut = true; }
        });

        await mgr.register('session-1');
        await new Promise(resolve => setTimeout(resolve, 400));

        expect(timedOut).toBe(true);
        mgr.destroy();
    }, 2000);

    test('should track statistics', async () => {
        await manager.register('session-1');
        await manager.register('session-2');

        const reg3 = await manager.register('session-3');
        await manager.receive(reg3.webhookId, {}, reg3.secret);

        const stats = manager.getStats();
        expect(stats.pending).toBe(2);
        expect(stats.received).toBe(1);
    });

    test('should return not found for invalid webhook', async () => {
        const result = await manager.receive('invalid-id', {});
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });

    test('should call onReceive callback', async () => {
        let received = null;
        const mgr = new WebhookManager({
            onReceive: (data) => { received = data; }
        });

        const reg = await mgr.register('session-1');
        await mgr.receive(reg.webhookId, { test: true }, reg.secret);

        expect(received).not.toBeNull();
        expect(received.sessionId).toBe('session-1');
        mgr.destroy();
    });
});
