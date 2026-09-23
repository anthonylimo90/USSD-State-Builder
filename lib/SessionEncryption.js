/**
 * Session Encryption - Encrypt session data at rest
 *
 * Provides an encryption layer that wraps any storage adapter to
 * encrypt sensitive session data before persistence. Uses Node.js
 * built-in crypto module (AES-256-GCM) for authenticated encryption.
 *
 * SECURITY NOTICE:
 * - Keep encryption keys secure (use environment variables or key management services)
 * - Rotate keys periodically using the key rotation support
 * - AES-256-GCM provides both confidentiality and integrity
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * Session data encryption utility
 */
class SessionEncryption {
    /**
     * Create a new SessionEncryption instance
     * @param {Object} options - Encryption options
     * @param {string|Buffer} options.encryptionKey - 32-byte encryption key (or string to derive from)
     * @param {string[]} [options.encryptFields] - Specific fields to encrypt (default: encrypt all data)
     * @param {boolean} [options.encryptState=false] - Whether to encrypt state names too
     * @param {Function} [options.keyDerivation] - Custom key derivation function
     *
     * @example
     * const encryption = new SessionEncryption({
     *   encryptionKey: process.env.USSD_ENCRYPTION_KEY,
     *   encryptFields: ['pin', 'accountNumber', 'phoneNumber']
     * });
     */
    constructor(options = {}) {
        if (!options.encryptionKey) {
            throw new Error('SessionEncryption requires an encryptionKey option');
        }

        this.encryptFields = options.encryptFields || null; // null = encrypt all
        this.encryptState = options.encryptState || false;

        // Derive key if string provided
        if (typeof options.encryptionKey === 'string') {
            if (options.keyDerivation) {
                this.key = options.keyDerivation(options.encryptionKey);
            } else {
                // Use PBKDF2 to derive a proper key from the string
                this.key = crypto.pbkdf2Sync(
                    options.encryptionKey,
                    'ussd-state-machine-salt',
                    100000,
                    KEY_LENGTH,
                    'sha256'
                );
            }
        } else if (Buffer.isBuffer(options.encryptionKey)) {
            if (options.encryptionKey.length !== KEY_LENGTH) {
                throw new Error(`Encryption key must be ${KEY_LENGTH} bytes`);
            }
            this.key = options.encryptionKey;
        } else {
            throw new Error('encryptionKey must be a string or Buffer');
        }
    }

    /**
     * Encrypt a string value
     * @param {string} plaintext - Value to encrypt
     * @returns {string} Encrypted value (base64 encoded: iv:authTag:ciphertext)
     */
    encrypt(plaintext) {
        if (plaintext === null || plaintext === undefined) {
            return plaintext;
        }

        const text = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        const authTag = cipher.getAuthTag();

        // Format: iv:authTag:ciphertext (all base64)
        return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
    }

    /**
     * Decrypt a string value
     * @param {string} ciphertext - Encrypted value
     * @returns {string} Decrypted value
     * @throws {Error} If decryption fails (wrong key or tampered data)
     */
    decrypt(ciphertext) {
        if (ciphertext === null || ciphertext === undefined) {
            return ciphertext;
        }

        const parts = ciphertext.split(':');
        if (parts.length !== 3) {
            // Not encrypted, return as-is (backwards compatibility)
            return ciphertext;
        }

        try {
            const iv = Buffer.from(parts[0], 'base64');
            const authTag = Buffer.from(parts[1], 'base64');
            const encrypted = parts[2];

            const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(encrypted, 'base64', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            throw new Error(`Decryption failed: ${error.message}. Possible key mismatch or data corruption.`);
        }
    }

    /**
     * Encrypt session data object
     * Encrypts either specific fields or the entire data object
     * @param {Object} data - Session data to encrypt
     * @returns {Object} Encrypted data
     */
    encryptData(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        if (this.encryptFields) {
            // Encrypt only specific fields
            const encrypted = { ...data };
            for (const field of this.encryptFields) {
                if (encrypted[field] !== undefined) {
                    encrypted[field] = this.encrypt(String(encrypted[field]));
                }
            }
            return encrypted;
        }

        // Encrypt entire data object
        return { _encrypted: this.encrypt(JSON.stringify(data)) };
    }

    /**
     * Decrypt session data object
     * @param {Object} data - Encrypted session data
     * @returns {Object} Decrypted data
     */
    decryptData(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        if (data._encrypted) {
            // Entire object was encrypted
            const decrypted = this.decrypt(data._encrypted);
            try {
                return JSON.parse(decrypted);
            } catch (e) {
                return decrypted;
            }
        }

        if (this.encryptFields) {
            // Decrypt specific fields
            const decrypted = { ...data };
            for (const field of this.encryptFields) {
                if (decrypted[field] !== undefined && typeof decrypted[field] === 'string' && decrypted[field].includes(':')) {
                    try {
                        decrypted[field] = this.decrypt(decrypted[field]);
                    } catch (e) {
                        // Field may not be encrypted, leave as-is
                    }
                }
            }
            return decrypted;
        }

        return data;
    }
}

/**
 * Create an encrypted storage adapter wrapper
 * Transparently encrypts/decrypts data as it flows through the storage layer
 * @param {Object} storage - Storage adapter to wrap
 * @param {Object} encryptionOptions - SessionEncryption options
 * @returns {Object} Wrapped storage with encryption
 *
 * @example
 * const encryptedStorage = createEncryptedStorage(redisStorage, {
 *   encryptionKey: process.env.USSD_ENCRYPTION_KEY,
 *   encryptFields: ['pin', 'accountNumber']
 * });
 *
 * const machine = new USSDStateMachine({
 *   storage: encryptedStorage,
 *   // ...
 * });
 */
function createEncryptedStorage(storage, encryptionOptions) {
    const encryption = new SessionEncryption(encryptionOptions);

    const handler = {
        get(target, prop) {
            const original = target[prop];

            if (typeof original !== 'function') {
                return original;
            }

            switch (prop) {
                case 'getData':
                    return async (...args) => {
                        const data = await original.apply(target, args);
                        return encryption.decryptData(data);
                    };

                case 'setData':
                    return async (sessionId, data, timeout) => {
                        // Storage adapters merge writes, so merge plaintext before
                        // encrypting the complete object as a single value.
                        const current = await target.getData(sessionId);
                        const merged = { ...encryption.decryptData(current), ...data };
                        const encryptedData = encryption.encryptData(merged);
                        return original.call(target, sessionId, encryptedData, timeout);
                    };

                case 'getSession':
                    return async (...args) => {
                        const storedSession = await original.apply(target, args);
                        // InMemoryStorage returns its stored object by reference.
                        const session = storedSession && { ...storedSession };
                        if (session && session.data) {
                            session.data = encryption.decryptData(session.data);
                        }
                        if (session && session.state && encryption.encryptState) {
                            session.state = encryption.decrypt(session.state);
                        }
                        return session;
                    };

                case 'setSession':
                    return async (sessionId, session) => {
                        const encryptedSession = { ...session };
                        if (encryptedSession.data) {
                            encryptedSession.data = encryption.encryptData(encryptedSession.data);
                        }
                        if (encryptedSession.state && encryption.encryptState) {
                            encryptedSession.state = encryption.encrypt(encryptedSession.state);
                        }
                        return original.call(target, sessionId, encryptedSession);
                    };

                case 'getState':
                    if (encryption.encryptState) {
                        return async (...args) => {
                            const state = await original.apply(target, args);
                            return state ? encryption.decrypt(state) : state;
                        };
                    }
                    return original.bind(target);

                case 'setState':
                    if (encryption.encryptState) {
                        return async (sessionId, state, timeout) => {
                            const encryptedState = encryption.encrypt(state);
                            return original.call(target, sessionId, encryptedState, timeout);
                        };
                    }
                    return original.bind(target);

                default:
                    return original.bind(target);
            }
        }
    };

    const proxy = new Proxy(storage, handler);
    proxy._encryption = encryption;
    return proxy;
}

module.exports = { SessionEncryption, createEncryptedStorage };
