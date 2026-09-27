/**
 * Webhook Manager - Async flow support for USSD State Machine
 *
 * Enables USSD flows to pause and wait for external events (e.g., payment
 * confirmations, OTP delivery, API callbacks) before resuming. Supports
 * webhook registration, timeout handling, and session state persistence
 * during the waiting period.
 */

const crypto = require('crypto');

/**
 * Manages async webhooks for USSD session pause/resume
 */
class WebhookManager {
    /**
     * Create a new WebhookManager
     * @param {Object} options - Configuration options
     * @param {Object} [options.storage] - Storage adapter for pending webhooks
     * @param {number} [options.defaultTimeout=300000] - Default webhook timeout in ms (5 min)
     * @param {string} [options.keyPrefix='ussd:webhook:'] - Storage key prefix
     * @param {Function} [options.onTimeout] - Callback when a webhook times out
     * @param {Function} [options.onReceive] - Callback when a webhook is received
     * @param {Function} [options.secretGenerator] - Custom secret generator for webhook verification
     *
     * @example
     * const webhooks = new WebhookManager({
     *   storage: redisStorage,
     *   defaultTimeout: 300000
     * });
     */
    constructor(options = {}) {
        this.storage = options.storage || null;
        this.defaultTimeout = options.defaultTimeout || 300000;
        this.keyPrefix = options.keyPrefix || 'ussd:webhook:';
        this.onTimeout = options.onTimeout || null;
        this.onReceive = options.onReceive || null;
        this.secretGenerator = options.secretGenerator || (() => crypto.randomBytes(32).toString('hex'));

        // In-memory store for pending webhooks (fallback when no storage provided)
        this._pending = new Map();
        this._timers = new Map();
        this._locks = new Map();
    }

    async _withWebhookLock(webhookId, fn) {
        const previous = this._locks.get(webhookId) || Promise.resolve();
        let release;
        const current = new Promise(resolve => { release = resolve; });
        this._locks.set(webhookId, current);
        await previous;
        try {
            const run = () => fn();
            return this.storage?.withSessionLock
                ? await this.storage.withSessionLock(`${this.keyPrefix}${webhookId}`, run)
                : await run();
        } finally {
            if (this._locks.get(webhookId) === current) this._locks.delete(webhookId);
            release();
        }
    }

    async _getWebhook(webhookId) {
        return this.storage?.getData
            ? this.storage.getData(`${this.keyPrefix}${webhookId}`)
            : this._pending.get(webhookId) || null;
    }

    async _setWebhook(webhookId, data, timeout) {
        if (this.storage?.setData) {
            await this.storage.setData(`${this.keyPrefix}${webhookId}`, data, timeout);
        } else {
            this._pending.set(webhookId, data);
        }
    }

    async _setPendingStatus(webhookId, data, timeout) {
        if (this.storage?.setDataIfStatus) {
            return this.storage.setDataIfStatus(
                `${this.keyPrefix}${webhookId}`, 'pending', data, timeout
            );
        }
        await this._setWebhook(webhookId, data, timeout);
        return true;
    }

    /**
     * Register a webhook for a session (pause the flow)
     * @param {string} sessionId - Session identifier
     * @param {Object} [options] - Webhook options
     * @param {string} [options.type='generic'] - Webhook type (e.g., 'payment', 'otp', 'approval')
     * @param {number} [options.timeout] - Custom timeout for this webhook
     * @param {string} [options.resumeState] - State to resume to when webhook is received
     * @param {Object} [options.metadata] - Additional metadata to store
     * @param {string} [options.waitingMessage='CON Please wait...'] - USSD response while waiting
     * @returns {Promise<Object>} Webhook registration info with ID and secret
     *
     * @example
     * // In a state handler:
     * const webhook = await webhooks.register(sessionId, {
     *   type: 'payment',
     *   resumeState: 'payment_result',
     *   metadata: { amount: 1000, currency: 'KES' }
     * });
     * // Return waiting response
     * return { response: 'END Payment initiated. You will receive a confirmation.' };
     */
    async register(sessionId, options = {}) {
        const webhookId = `wh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const secret = this.secretGenerator();
        const timeout = options.timeout || this.defaultTimeout;

        const webhookData = {
            id: webhookId,
            sessionId,
            type: options.type || 'generic',
            resumeState: options.resumeState || null,
            metadata: options.metadata || {},
            waitingMessage: options.waitingMessage || 'CON Please wait...',
            secret,
            status: 'pending',
            createdAt: Date.now(),
            expiresAt: Date.now() + timeout
        };

        // Store webhook
        if (this.storage && this.storage.setData) {
            const key = `${this.keyPrefix}${webhookId}`;
            await this.storage.setData(key, webhookData, Math.ceil(timeout / 1000));
        } else {
            this._pending.set(webhookId, webhookData);
        }

        // Set timeout
        const timer = setTimeout(async () => {
            await this._handleTimeout(webhookId);
        }, timeout);

        if (timer.unref) timer.unref();
        this._timers.set(webhookId, timer);

        return {
            webhookId,
            secret,
            expiresAt: webhookData.expiresAt,
            callbackUrl: `/webhook/${webhookId}` // Suggested URL pattern
        };
    }

    /**
     * Receive a webhook callback (resume the flow)
     * @param {string} webhookId - Webhook identifier
     * @param {Object} payload - Webhook payload data
     * @param {string} secret - Webhook secret for verification
     * @returns {Promise<Object>} Result with session info and resume state
     *
     * @example
     * // In Express webhook endpoint:
     * app.post('/webhook/:id', async (req, res) => {
     *   const result = await webhooks.receive(req.params.id, req.body, req.headers['x-webhook-secret']);
     *   if (result.success) {
     *     // Trigger USSD session resume (carrier-specific)
     *     res.json({ status: 'received' });
     *   }
     * });
     */
    async receive(webhookId, payload = {}, secret = null) {
        return this._withWebhookLock(webhookId, async () => {
            const webhookData = await this._getWebhook(webhookId);

            if (!webhookData) {
                return { success: false, error: 'Webhook not found or expired' };
            }

            if (webhookData.status !== 'pending') {
                return { success: false, error: `Webhook already ${webhookData.status}` };
            }

            // Every registered webhook has a secret; an omitted secret is invalid.
            const expected = Buffer.from(webhookData.secret);
            const received = typeof secret === 'string' ? Buffer.from(secret) : Buffer.alloc(0);
            if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
                return { success: false, error: 'Invalid webhook secret' };
            }

            const receivedData = { ...webhookData, status: 'received', payload, receivedAt: Date.now() };
            if (!await this._setPendingStatus(webhookId, receivedData, 300)) {
                const latest = await this._getWebhook(webhookId);
                return { success: false, error: latest ? `Webhook already ${latest.status}` : 'Webhook not found or expired' };
            }

            const timer = this._timers.get(webhookId);
            if (timer) {
                clearTimeout(timer);
                this._timers.delete(webhookId);
            }

            if (this.onReceive) this.onReceive(receivedData);

            return {
                success: true,
                sessionId: receivedData.sessionId,
                resumeState: receivedData.resumeState,
                metadata: receivedData.metadata,
                payload,
                webhookId
            };
        });
    }

    /**
     * Check the status of a webhook
     * @param {string} webhookId - Webhook identifier
     * @returns {Promise<Object|null>} Webhook status or null if not found
     */
    async getStatus(webhookId) {
        return this._getWebhook(webhookId);
    }

    /**
     * Cancel a pending webhook
     * @param {string} webhookId - Webhook identifier
     * @returns {Promise<boolean>} Whether the webhook was cancelled
     */
    async cancel(webhookId) {
        return this._withWebhookLock(webhookId, async () => {
            const data = await this._getWebhook(webhookId);
            if (!data || data.status !== 'pending') return false;
            if (!await this._setPendingStatus(webhookId, { ...data, status: 'cancelled' }, 60)) return false;
            const timer = this._timers.get(webhookId);
            if (timer) clearTimeout(timer);
            this._timers.delete(webhookId);
            return true;
        });
    }

    /**
     * Handle webhook timeout
     * @private
     */
    async _handleTimeout(webhookId) {
        return this._withWebhookLock(webhookId, async () => {
            this._timers.delete(webhookId);
            const webhookData = await this._getWebhook(webhookId);
            if (!webhookData || webhookData.status !== 'pending') return;
            const timedOutData = { ...webhookData, status: 'timeout' };
            if (!await this._setPendingStatus(webhookId, timedOutData, 60)) return;
            if (this.onTimeout) this.onTimeout(timedOutData);
        });
    }

    /**
     * Get all pending webhooks for a session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object[]>} Array of pending webhook data
     */
    async getPendingForSession(sessionId) {
        const pending = [];
        for (const [, data] of this._pending) {
            if (data.sessionId === sessionId && data.status === 'pending') {
                pending.push(data);
            }
        }
        return pending;
    }

    /**
     * Clean up all timers (for graceful shutdown)
     */
    destroy() {
        for (const [, timer] of this._timers) {
            clearTimeout(timer);
        }
        this._timers.clear();
        this._pending.clear();
    }

    /**
     * Get webhook manager statistics
     * @returns {Object} Statistics
     */
    getStats() {
        let pending = 0;
        let received = 0;
        let timeout = 0;
        let cancelled = 0;

        for (const [, data] of this._pending) {
            switch (data.status) {
                case 'pending': pending++; break;
                case 'received': received++; break;
                case 'timeout': timeout++; break;
                case 'cancelled': cancelled++; break;
            }
        }

        return { pending, received, timeout, cancelled, total: this._pending.size };
    }
}

module.exports = { WebhookManager };
