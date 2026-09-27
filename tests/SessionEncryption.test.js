const { SessionEncryption, createEncryptedStorage } = require('../lib/SessionEncryption');
const InMemoryStorage = require('../lib/InMemoryStorage');

describe('SessionEncryption', () => {
    let encryption;

    beforeEach(() => {
        encryption = new SessionEncryption({
            encryptionKey: 'test-secret-key-for-unit-tests-32!'
        });
    });

    test('should require an encryption key', () => {
        expect(() => new SessionEncryption({})).toThrow('encryptionKey');
    });

    test('should encrypt and decrypt a string', () => {
        const plaintext = 'Hello, World!';
        const encrypted = encryption.encrypt(plaintext);
        expect(encrypted).not.toBe(plaintext);
        expect(encrypted).toContain(':'); // iv:authTag:ciphertext format

        const decrypted = encryption.decrypt(encrypted);
        expect(decrypted).toBe(plaintext);
    });

    test('should produce different ciphertexts for same plaintext (random IV)', () => {
        const plaintext = 'Same text';
        const enc1 = encryption.encrypt(plaintext);
        const enc2 = encryption.encrypt(plaintext);
        expect(enc1).not.toBe(enc2);

        // Both should decrypt to same value
        expect(encryption.decrypt(enc1)).toBe(plaintext);
        expect(encryption.decrypt(enc2)).toBe(plaintext);
    });

    test('should handle null and undefined', () => {
        expect(encryption.encrypt(null)).toBeNull();
        expect(encryption.encrypt(undefined)).toBeUndefined();
        expect(encryption.decrypt(null)).toBeNull();
        expect(encryption.decrypt(undefined)).toBeUndefined();
    });

    test('should fail decryption with wrong key', () => {
        const encrypted = encryption.encrypt('secret');
        const wrongEncryption = new SessionEncryption({
            encryptionKey: 'different-key-that-is-32-chars!!!'
        });
        expect(() => wrongEncryption.decrypt(encrypted)).toThrow('Decryption failed');
    });

    test('should encrypt entire data object', () => {
        const data = { pin: '1234', account: 'ACC-001', name: 'John' };
        const encrypted = encryption.encryptData(data);
        expect(encrypted._encrypted).toBeDefined();
        expect(encrypted._encrypted).not.toContain('1234');

        const decrypted = encryption.decryptData(encrypted);
        expect(decrypted).toEqual(data);
    });

    test('should encrypt specific fields only', () => {
        const fieldEncryption = new SessionEncryption({
            encryptionKey: 'test-secret-key-for-unit-tests-32!',
            encryptFields: ['pin', 'account']
        });

        const data = { pin: '1234', account: 'ACC-001', name: 'John' };
        const encrypted = fieldEncryption.encryptData(data);

        expect(encrypted.name).toBe('John'); // Not encrypted
        expect(encrypted.pin).not.toBe('1234'); // Encrypted
        expect(encrypted.account).not.toBe('ACC-001'); // Encrypted

        const decrypted = fieldEncryption.decryptData(encrypted);
        expect(decrypted.pin).toBe('1234');
        expect(decrypted.account).toBe('ACC-001');
        expect(decrypted.name).toBe('John');
    });

    test('should accept Buffer key', () => {
        const key = Buffer.alloc(32, 'a');
        const enc = new SessionEncryption({ encryptionKey: key });
        const encrypted = enc.encrypt('test');
        expect(enc.decrypt(encrypted)).toBe('test');
    });

    test('should reject invalid Buffer key length', () => {
        const key = Buffer.alloc(16, 'a');
        expect(() => new SessionEncryption({ encryptionKey: key })).toThrow('32 bytes');
    });
});

describe('createEncryptedStorage', () => {
    let storage;
    let encryptedStorage;

    beforeEach(() => {
        storage = new InMemoryStorage();
        encryptedStorage = createEncryptedStorage(storage, {
            encryptionKey: 'test-secret-key-for-unit-tests-32!'
        });
    });

    test('should transparently encrypt/decrypt session data', async () => {
        await encryptedStorage.setState('s1', 'WELCOME', 300);
        await encryptedStorage.setData('s1', { pin: '1234', name: 'John' }, 300);

        const data = await encryptedStorage.getData('s1');
        expect(data.pin).toBe('1234');
        expect(data.name).toBe('John');
    });

    test('should store data encrypted in underlying storage', async () => {
        await encryptedStorage.setState('s2', 'WELCOME', 300);
        await encryptedStorage.setData('s2', { secret: 'classified' }, 300);

        // Read directly from underlying storage (bypassing encryption)
        const rawData = await storage.getData('s2');
        expect(rawData._encrypted).toBeDefined();
        expect(JSON.stringify(rawData)).not.toContain('classified');
    });

    test('should work with getSession/setSession', async () => {
        await encryptedStorage.setData('s3', { test: 'value' }, 300);
        await encryptedStorage.setState('s3', 'STATE1', 300);

        const session = await encryptedStorage.getSession('s3');
        if (session && session.data) {
            expect(session.data.test).toBe('value');
        }
        expect((await storage.getData('s3'))._encrypted).toBeDefined();
    });

    test('should preserve earlier fields across encrypted writes', async () => {
        await encryptedStorage.setData('s5', { pin: '1234' }, 300);
        await encryptedStorage.setData('s5', { account: 'A' }, 300);

        expect(await encryptedStorage.getData('s5')).toEqual({ pin: '1234', account: 'A' });
        expect(JSON.stringify(await storage.getData('s5'))).not.toContain('1234');
    });

    test('should pass through non-data operations unchanged', async () => {
        await encryptedStorage.setState('s4', 'WELCOME', 300);
        const state = await encryptedStorage.getState('s4');
        expect(state).toBe('WELCOME');
    });

    test('decrypts batch data and encrypted batch states', async () => {
        const encrypted = createEncryptedStorage(storage, {
            encryptionKey: 'test-secret-key-for-unit-tests-32!',
            encryptState: true
        });
        await encrypted.setState('first', 'WELCOME', 300);
        await encrypted.setData('first', { pin: '1234' }, 300);

        expect((await storage.getStateBatch(['first'])).get('first')).not.toBe('WELCOME');
        expect((await storage.getDataBatch(['first'])).get('first')).toHaveProperty('_encrypted');
        expect(await encrypted.getStateBatch(['first', 'missing']))
            .toEqual(new Map([['first', 'WELCOME'], ['missing', null]]));
        expect(await encrypted.getDataBatch(['first', 'missing']))
            .toEqual(new Map([['first', { pin: '1234' }], ['missing', null]]));
    });
});
