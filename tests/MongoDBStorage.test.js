const MongoDBStorage = require('../lib/MongoDBStorage');

describe('MongoDBStorage statistics', () => {
    let storage;
    let collection;
    let db;

    beforeEach(() => {
        collection = {
            createIndex: jest.fn().mockResolvedValue('index'),
            countDocuments: jest.fn().mockResolvedValue(3)
        };
        db = {
            collection: jest.fn().mockReturnValue(collection),
            command: jest.fn().mockResolvedValue({ storageSize: 4096, avgObjSize: 128 })
        };
        storage = new MongoDBStorage({
            client: { db: jest.fn().mockReturnValue(db) },
            database: 'test_ussd',
            collection: 'test_sessions'
        });
    });

    test('reads collection statistics through the database command API', async () => {
        expect(await storage.getStats()).toEqual({
            type: 'MongoDBStorage',
            connected: true,
            database: 'test_ussd',
            collection: 'test_sessions',
            sessionCount: 3,
            storageSize: 4096,
            avgObjectSize: 128
        });
        expect(storage.client.db).toHaveBeenCalledWith('test_ussd');
        expect(db.collection).toHaveBeenCalledWith('test_sessions');
        expect(collection.countDocuments).toHaveBeenCalledTimes(1);
        expect(db.command).toHaveBeenCalledWith({ collStats: 'test_sessions' });
    });

    test('propagates a statistics command failure', async () => {
        const error = new Error('Statistics command denied');
        db.command.mockRejectedValue(error);

        await expect(storage.getStats()).rejects.toBe(error);
    });
});
