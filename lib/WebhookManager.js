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
        let webhookData;

        if (this.storage && this.storage.getData) {
            const key = `${this.keyPrefix}${webhookId}`;
            webhookData = await this.storage.getData(key);
        } else {
            webhookData = this._pending.get(webhookId);
        }

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

        // Update webhook status
        webhookData.status = 'received';
        webhookData.payload = payload;
        webhookData.receivedAt = Date.now();

        // Update storage
        if (this.storage && this.storage.setData) {
            const key = `${this.keyPrefix}${webhookId}`;
            await this.storage.setData(key, webhookData, 300);
        } else {
            this._pending.set(webhookId, webhookData);
        }

        // Clear timeout
        const timer = this._timers.get(webhookId);
        if (timer) {
            clearTimeout(timer);
            this._timers.delete(webhookId);
        }

        // Notify callback
        if (this.onReceive) {
            this.onReceive(webhookData);
        }

        return {
            success: true,
            sessionId: webhookData.sessionId,
            resumeState: webhookData.resumeState,
            metadata: webhookData.metadata,
            payload,
            webhookId
        };
    }

    /**
     * Check the status of a webhook
     * @param {string} webhookId - Webhook identifier
     * @returns {Promise<Object|null>} Webhook status or null if not found
     */
    async getStatus(webhookId) {
        if (this.storage && this.storage.getData) {
            const key = `${this.keyPrefix}${webhookId}`;
            return await this.storage.getData(key);
        }
        return this._pending.get(webhookId) || null;
    }

    /**
     * Cancel a pending webhook
     * @param {string} webhookId - Webhook identifier
     * @returns {Promise<boolean>} Whether the webhook was cancelled
     */
    async cancel(webhookId) {
        const timer = this._timers.get(webhookId);
        if (timer) {
            clearTimeout(timer);
            this._timers.delete(webhookId);
        }

        if (this.storage && this.storage.getData) {
            const key = `${this.keyPrefix}${webhookId}`;
            const data = await this.storage.getData(key);
            if (data) {
                data.status = 'cancelled';
                await this.storage.setData(key, data, 60);
                return true;
            }
        } else {
            const data = this._pending.get(webhookId);
            if (data) {
                data.status = 'cancelled';
                return true;
            }
        }

        return false;
    }

    /**
     * Handle webhook timeout
     * @private
     */
    async _handleTimeout(webhookId) {
        this._timers.delete(webhookId);

        let webhookData;
        if (this.storage && this.storage.getData) {
            const key = `${this.keyPrefix}${webhookId}`;
            webhookData = await this.storage.getData(key);
            if (webhookData && webhookData.status === 'pending') {
                webhookData.status = 'timeout';
                await this.storage.setData(key, webhookData, 60);
            }
        } else {
            webhookData = this._pending.get(webhookId);
            if (webhookData && webhookData.status === 'pending') {
                webhookData.status = 'timeout';
            }
        }

        if (webhookData && this.onTimeout) {
            this.onTimeout(webhookData);
        }
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
