const redis = require('../config/redis');
const { v4: uuidv4 } = require('uuid');

const SESSION_PREFIX = 'session:';
const LOCK_PREFIX = 'user_lock:';
const RINGING_TTL = 35;   // seconds — slightly longer than 30s timeout
const ACTIVE_TTL = 7200;  // 2 hours max call duration

const sessionManager = {
    async createSession({ callerId, hostId, callType, ratePerMinute, audioRate, videoRate }) {
        const sessionId = uuidv4();
        const session = {
            sessionId,
            callerId,
            hostId,
            callType: callType || 'AUDIO',
            state: 'INITIATED',
            ratePerMinute: parseFloat(ratePerMinute) || 1.0,
            audioRate: parseFloat(audioRate) || parseFloat(ratePerMinute) || 1.0,
            videoRate: parseFloat(videoRate) || (parseFloat(ratePerMinute) || 1.0) * 1.5,
            createdAt: new Date().toISOString(),
            answeredAt: null,
            endedAt: null,
            durationSeconds: 0,
            lastBillingTick: 0,
            terminationReason: null,
        };

        await redis.set(
            `${SESSION_PREFIX}${sessionId}`,
            JSON.stringify(session),
            'EX', RINGING_TTL
        );

        return session;
    },

    async getSession(sessionId) {
        const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);
        return data ? JSON.parse(data) : null;
    },

    async updateSession(sessionId, updates) {
        const session = await this.getSession(sessionId);
        if (!session) return null;

        const updated = { ...session, ...updates };

        // Extend TTL when call becomes active
        const ttl = updated.state === 'ACTIVE' ? ACTIVE_TTL : RINGING_TTL;
        await redis.set(
            `${SESSION_PREFIX}${sessionId}`,
            JSON.stringify(updated),
            'EX', ttl
        );

        return updated;
    },

    async deleteSession(sessionId) {
        await redis.del(`${SESSION_PREFIX}${sessionId}`);
    },

    // User locks — prevent concurrent calls
    async lockUser(userId, sessionId) {
        await redis.set(`${LOCK_PREFIX}${userId}`, sessionId, 'EX', ACTIVE_TTL);
    },

    async isUserLocked(userId) {
        const lock = await redis.get(`${LOCK_PREFIX}${userId}`);
        return lock;
    },

    async unlockUser(userId) {
        await redis.del(`${LOCK_PREFIX}${userId}`);
    },

    // Find active session for a user (for crash recovery)
    async findActiveSessionForUser(userId) {
        // Check if user has a lock
        const sessionId = await this.isUserLocked(userId);
        if (!sessionId) return null;

        const session = await this.getSession(sessionId);
        if (!session) {
            // Stale lock — clean up
            await this.unlockUser(userId);
            return null;
        }

        if (session.state === 'ACTIVE' || session.state === 'RINGING' || session.state === 'INITIATED' || session.state === 'RECONNECTING') {
            return session;
        }

        return null;
    },
};

module.exports = sessionManager;
