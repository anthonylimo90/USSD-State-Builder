const { randomUUID } = require('crypto');
const { createApp, RedisStorage, MongoDBStorage, PostgreSQLStorage } = require('../..');

const live = process.env.RUN_INTEGRATION ? describe : describe.skip;
const adapters = [
    ['Redis', () => new RedisStorage({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        keyPrefix: 'ussd:runtime-regressions:'
    })]
];
if (process.env.MONGODB_URI) adapters.push(['MongoDB', () => new MongoDBStorage({
    uri: process.env.MONGODB_URI,
    database: process.env.MONGODB_DATABASE || 'ussd_conformance',
    collection: 'runtime_regressions'
})]);
if (process.env.POSTGRES_URL) adapters.push(['PostgreSQL', () => new PostgreSQLStorage({
    connectionString: process.env.POSTGRES_URL,
    table: 'ussd_runtime_regressions'
})]);

live.each(adapters)('%s runtime persistence', (name, createStorage) => {
    let storage;
    let sessionId;

    beforeEach(async () => {
        storage = createStorage();
        sessionId = randomUUID();
        await storage._ensureConnected();
    });

    afterEach(async () => {
        try { await storage.deleteSession(sessionId); }
        finally { await storage.close(); }
    });

    test.each(['field', 'callback'])('saves quantity after a dynamic selection using a %s', async saveMode => {
        const saveQuantity = saveMode === 'field' ? 'quantity' : input => ({ quantity: input });
        const app = createApp().storage(storage).flowVersion('shop-v1').logger(null)
            .state('items', s => s.dynamicMenu(async () => ['Seed pack']).save('item').next('quantity'))
            .state('quantity', s => s.message('Enter quantity').save(saveQuantity).next('done'))
            .state('done', s => s.run((input, id, ctx) =>
                `${ctx.sessionData.item}: ${ctx.sessionData.quantity}`).end()).build();

        expect(await app.processInput(sessionId, '')).toContain('Seed pack');
        expect(await app.processInput(sessionId, '1')).toBe('CON Enter quantity');
        expect(await app.processInput(sessionId, '5')).toBe('END Seed pack: 5');
        expect(await storage.getData(sessionId)).toMatchObject({ item: 'Seed pack', quantity: '5' });
    });

    test.each(['same flow', 'removed state', 'new version'])('checks request middleware before replay with %s', async deployment => {
        const effect = jest.fn(() => ({ response: 'END Original receipt' }));
        const original = createApp().storage(storage).flowVersion('v1').logger(null)
            .state('done', s => s.run(effect)).build();
        await original.processInput(sessionId, '');
        const app = deployment === 'same flow' ? original : createApp().storage(storage).logger(null)
            .flowVersion(deployment === 'new version' ? 'v2' : 'v1')
            .state('home', s => s.message('New home')).build();
        let blocked = true;
        const before = jest.fn(async (context, next) => {
            if (blocked) {
                context.blocked = true;
                context.response = 'END Access denied';
                return;
            }
            await next();
        });
        app.use('beforeProcess', before);

        expect(await app.processInput(sessionId, '1')).toBe('END Access denied');
        blocked = false;
        expect(await app.processInput(sessionId, '1')).toBe('END Original receipt');
        expect(before).toHaveBeenCalledTimes(2);
        expect(effect).toHaveBeenCalledTimes(1);
        expect((await storage.getData(sessionId)).__ussdFlow.version).toBe('v1');
    });

    if (name === 'MongoDB') test('returns statistics from the live MongoDB collection', async () => {
        await storage.setState(sessionId, 'HOME', 300);
        await storage.setData(sessionId, { item: 'Seed pack' }, 300);

        const stats = await storage.getStats();
        expect(stats).toMatchObject({ type: 'MongoDBStorage', connected: true,
            collection: 'runtime_regressions', sessionCount: 1 });
        expect(stats.storageSize).toBeGreaterThanOrEqual(0);
        expect(stats.avgObjectSize).toBeGreaterThan(0);
    });
});
