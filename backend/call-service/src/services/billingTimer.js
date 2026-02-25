const axios = require('axios');
const { publishEvent } = require('../config/kafka');
const sessionManager = require('./sessionManager');

const BILLING_INTERVAL_MS = 60000; // 60 seconds
const BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL || 'http://billing-service:3006';

// Active timer references: sessionId → intervalId
const activeTimers = new Map();

const billingTimer = {
    start(sessionId, io) {
        if (activeTimers.has(sessionId)) return; // already running

        console.log(`Billing timer started for session ${sessionId}`);
        let tickCount = 0;

        const intervalId = setInterval(async () => {
            tickCount++;
            try {
                const session = await sessionManager.getSession(sessionId);
                if (!session || session.state !== 'ACTIVE') {
                    console.log(`Session ${sessionId} no longer active — stopping timer`);
                    billingTimer.stop(sessionId);
                    return;
                }

                // Update session duration
                const answeredAt = new Date(session.answeredAt);
                const durationSeconds = Math.floor((Date.now() - answeredAt.getTime()) / 1000);
                await sessionManager.updateSession(sessionId, {
                    durationSeconds,
                    lastBillingTick: tickCount,
                });

                // Call billing service to deduct
                const eventId = `${sessionId}_tick_${tickCount}`;
                const response = await axios.post(`${BILLING_SERVICE_URL}/wallet/deduct-minute`, {
                    sessionId,
                    callerId: session.callerId,
                    hostId: session.hostId,
                    ratePerMinute: session.ratePerMinute,
                    eventId,
                    tickNumber: tickCount,
                }, {
                    headers: { 'x-user-id': session.callerId },
                });

                const { remainingBalance } = response.data;

                // Publish billing tick event
                await publishEvent('call.billing-tick', {
                    sessionId,
                    callerId: session.callerId,
                    hostId: session.hostId,
                    tickNumber: tickCount,
                    amountDeducted: session.ratePerMinute,
                    remainingBalance,
                });

                // Notify clients of billing update
                io.to(`call:${sessionId}`).emit('billing_update', {
                    sessionId,
                    durationSeconds,
                    tickNumber: tickCount,
                    remainingBalance,
                    costSoFar: tickCount * session.ratePerMinute,
                });

                // Warn if low balance (< 2 minutes remaining)
                if (remainingBalance < session.ratePerMinute * 2) {
                    io.to(`call:${sessionId}`).emit('low_balance_warning', {
                        sessionId,
                        remainingBalance,
                        minutesRemaining: Math.floor(remainingBalance / session.ratePerMinute),
                    });
                }

            } catch (err) {
                if (err.response && err.response.status === 402) {
                    // Insufficient balance — end call
                    console.log(`Balance depleted for session ${sessionId}`);
                    billingTimer.stop(sessionId);

                    const session = await sessionManager.getSession(sessionId);
                    if (session) {
                        const answeredAt = new Date(session.answeredAt);
                        const durationSeconds = Math.floor((Date.now() - answeredAt.getTime()) / 1000);

                        await sessionManager.updateSession(sessionId, {
                            state: 'ENDED',
                            endedAt: new Date().toISOString(),
                            durationSeconds,
                            terminationReason: 'BALANCE_DEPLETED',
                        });

                        // Notify both parties
                        io.to(`call:${sessionId}`).emit('call_ended', {
                            sessionId,
                            reason: 'BALANCE_DEPLETED',
                            durationSeconds,
                            totalCost: tickCount * session.ratePerMinute,
                        });

                        // Unlock users
                        await sessionManager.unlockUser(session.callerId);
                        await sessionManager.unlockUser(session.hostId);

                        // Publish event
                        await publishEvent('call.ended', {
                            sessionId,
                            callerId: session.callerId,
                            hostId: session.hostId,
                            durationSeconds,
                            callType: session.callType,
                            rateApplied: session.ratePerMinute,
                            terminationReason: 'BALANCE_DEPLETED',
                        });
                    }
                } else {
                    console.error(`Billing tick error for session ${sessionId}:`, err.message);
                }
            }
        }, BILLING_INTERVAL_MS);

        activeTimers.set(sessionId, intervalId);
    },

    stop(sessionId) {
        const intervalId = activeTimers.get(sessionId);
        if (intervalId) {
            clearInterval(intervalId);
            activeTimers.delete(sessionId);
            console.log(`Billing timer stopped for session ${sessionId}`);
        }
    },

    isRunning(sessionId) {
        return activeTimers.has(sessionId);
    },
};

module.exports = billingTimer;
