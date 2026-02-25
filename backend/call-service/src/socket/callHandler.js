const axios = require('axios');
const sessionManager = require('../services/sessionManager');
const { generateAgoraToken } = require('../services/agoraTokenService');
const billingTimer = require('../services/billingTimer');
const { publishEvent } = require('../config/kafka');

const BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL || 'http://billing-service:3006';
const CALL_TIMEOUT_MS = 30000; // 30 seconds to answer

// Track timeout timers: sessionId → timeoutId
const callTimeouts = new Map();

module.exports = function callHandler(io, socket) {
    const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
    if (!userId) {
        socket.disconnect();
        return;
    }

    // Join personal room for notifications
    socket.join(`user:${userId}`);
    console.log(`Call socket connected: user ${userId}`);

    // ─── INITIATE CALL ───
    socket.on('initiate_call', async (data) => {
        try {
            const { hostId, hostRate, callType } = data;
            if (!hostId || !hostRate) {
                return socket.emit('call_error', { error: 'Missing hostId or hostRate' });
            }

            // Check user locks
            const callerLock = await sessionManager.isUserLocked(userId);
            if (callerLock) {
                return socket.emit('call_error', { error: 'You are already in a call' });
            }

            const hostLock = await sessionManager.isUserLocked(hostId);
            if (hostLock) {
                return socket.emit('call_error', { error: 'Host is currently in another call' });
            }

            // Pre-authorise billing (lock credits for 1 minute)
            let preAuthId;
            try {
                const resp = await axios.post(`${BILLING_SERVICE_URL}/wallet/pre-auth`, {
                    callerId: userId,
                    hostId,
                    ratePerMinute: hostRate,
                }, {
                    headers: { 'x-user-id': userId },
                });
                preAuthId = resp.data.preAuthId;
            } catch (err) {
                if (err.response && err.response.status === 402) {
                    return socket.emit('call_error', {
                        error: 'INSUFFICIENT_BALANCE',
                        message: 'Not enough credits to start a call',
                    });
                }
                throw err;
            }

            // Create session
            const session = await sessionManager.createSession({
                callerId: userId,
                hostId,
                callType: callType || 'AUDIO',
                ratePerMinute: hostRate,
            });

            // Store pre-auth ID on session
            await sessionManager.updateSession(session.sessionId, {
                state: 'RINGING',
                preAuthId,
            });

            // Lock both users
            await sessionManager.lockUser(userId, session.sessionId);
            await sessionManager.lockUser(hostId, session.sessionId);

            // Join call room
            socket.join(`call:${session.sessionId}`);

            // Notify caller
            socket.emit('call_initiated', {
                sessionId: session.sessionId,
                hostId,
                callType: session.callType,
                ratePerMinute: session.ratePerMinute,
            });

            // Notify host via their personal room
            io.to(`user:${hostId}`).emit('incoming_call', {
                sessionId: session.sessionId,
                callerId: userId,
                callType: session.callType,
                ratePerMinute: session.ratePerMinute,
            });

            // Publish Kafka event
            await publishEvent('call.initiated', {
                sessionId: session.sessionId,
                callerId: userId,
                hostId,
                callType: session.callType,
            });

            // Set timeout for unanswered call
            const timeoutId = setTimeout(async () => {
                const sess = await sessionManager.getSession(session.sessionId);
                if (sess && sess.state === 'RINGING') {
                    await sessionManager.updateSession(session.sessionId, {
                        state: 'EXPIRED',
                        endedAt: new Date().toISOString(),
                        terminationReason: 'TIMEOUT',
                    });

                    // Release pre-auth
                    try {
                        await axios.post(`${BILLING_SERVICE_URL}/wallet/release-pre-auth`, {
                            preAuthId: sess.preAuthId,
                            callerId: userId,
                        }, { headers: { 'x-user-id': userId } });
                    } catch (e) { console.error('Release pre-auth error:', e.message); }

                    // Unlock users
                    await sessionManager.unlockUser(userId);
                    await sessionManager.unlockUser(hostId);

                    // Notify both
                    io.to(`call:${session.sessionId}`).emit('call_expired', {
                        sessionId: session.sessionId,
                        reason: 'TIMEOUT',
                    });
                    io.to(`user:${hostId}`).emit('call_expired', {
                        sessionId: session.sessionId,
                        reason: 'TIMEOUT',
                    });
                }
                callTimeouts.delete(session.sessionId);
            }, CALL_TIMEOUT_MS);

            callTimeouts.set(session.sessionId, timeoutId);

        } catch (err) {
            console.error('initiate_call error:', err);
            socket.emit('call_error', { error: 'Failed to initiate call' });
        }
    });

    // ─── ACCEPT CALL ───
    socket.on('accept_call', async (data) => {
        try {
            const { sessionId } = data;
            const session = await sessionManager.getSession(sessionId);

            if (!session || session.hostId !== userId) {
                return socket.emit('call_error', { error: 'Invalid session' });
            }
            if (session.state !== 'RINGING') {
                return socket.emit('call_error', { error: 'Call is no longer ringing' });
            }

            // Clear timeout
            const timeoutId = callTimeouts.get(sessionId);
            if (timeoutId) {
                clearTimeout(timeoutId);
                callTimeouts.delete(sessionId);
            }

            // Transition to ACTIVE
            const now = new Date().toISOString();
            await sessionManager.updateSession(sessionId, {
                state: 'ACTIVE',
                answeredAt: now,
            });

            // Generate Agora tokens
            const callerToken = generateAgoraToken(sessionId, 1);
            const hostToken = generateAgoraToken(sessionId, 2);

            // Join call room
            socket.join(`call:${sessionId}`);

            // Notify both parties
            io.to(`user:${session.callerId}`).emit('call_accepted', {
                sessionId,
                agoraToken: callerToken,
                hostId: session.hostId,
                ratePerMinute: session.ratePerMinute,
                answeredAt: now,
            });

            socket.emit('call_accepted', {
                sessionId,
                agoraToken: hostToken,
                callerId: session.callerId,
                ratePerMinute: session.ratePerMinute,
                answeredAt: now,
            });

            // Publish Kafka event
            await publishEvent('call.accepted', {
                sessionId,
                callerId: session.callerId,
                hostId: session.hostId,
                callType: session.callType,
                ratePerMinute: session.ratePerMinute,
            });

            // Start billing timer
            billingTimer.start(sessionId, io);

        } catch (err) {
            console.error('accept_call error:', err);
            socket.emit('call_error', { error: 'Failed to accept call' });
        }
    });

    // ─── DECLINE CALL ───
    socket.on('decline_call', async (data) => {
        try {
            const { sessionId } = data;
            const session = await sessionManager.getSession(sessionId);

            if (!session || session.hostId !== userId) {
                return socket.emit('call_error', { error: 'Invalid session' });
            }

            // Clear timeout
            const timeoutId = callTimeouts.get(sessionId);
            if (timeoutId) {
                clearTimeout(timeoutId);
                callTimeouts.delete(sessionId);
            }

            await sessionManager.updateSession(sessionId, {
                state: 'ENDED',
                endedAt: new Date().toISOString(),
                terminationReason: 'DECLINED',
            });

            // Release pre-auth
            try {
                await axios.post(`${BILLING_SERVICE_URL}/wallet/release-pre-auth`, {
                    preAuthId: session.preAuthId,
                    callerId: session.callerId,
                }, { headers: { 'x-user-id': session.callerId } });
            } catch (e) { console.error('Release pre-auth error:', e.message); }

            // Unlock users
            await sessionManager.unlockUser(session.callerId);
            await sessionManager.unlockUser(session.hostId);

            // Notify caller
            io.to(`user:${session.callerId}`).emit('call_declined', {
                sessionId,
                reason: 'Host declined the call',
            });

        } catch (err) {
            console.error('decline_call error:', err);
            socket.emit('call_error', { error: 'Failed to decline call' });
        }
    });

    // ─── CANCEL CALL ───
    socket.on('cancel_call', async (data) => {
        try {
            const { sessionId } = data;
            const session = await sessionManager.getSession(sessionId);

            if (!session || session.callerId !== userId) {
                return socket.emit('call_error', { error: 'Invalid session' });
            }

            // Clear timeout
            const timeoutId = callTimeouts.get(sessionId);
            if (timeoutId) {
                clearTimeout(timeoutId);
                callTimeouts.delete(sessionId);
            }

            await sessionManager.updateSession(sessionId, {
                state: 'ENDED',
                endedAt: new Date().toISOString(),
                terminationReason: 'CALLER_CANCELLED',
            });

            // Release pre-auth
            try {
                await axios.post(`${BILLING_SERVICE_URL}/wallet/release-pre-auth`, {
                    preAuthId: session.preAuthId,
                    callerId: userId,
                }, { headers: { 'x-user-id': userId } });
            } catch (e) { console.error('Release pre-auth error:', e.message); }

            // Unlock users
            await sessionManager.unlockUser(session.callerId);
            await sessionManager.unlockUser(session.hostId);

            // Notify host
            io.to(`user:${session.hostId}`).emit('call_cancelled', {
                sessionId,
                reason: 'Caller cancelled the call',
            });

        } catch (err) {
            console.error('cancel_call error:', err);
            socket.emit('call_error', { error: 'Failed to cancel call' });
        }
    });

    // ─── END CALL ───
    socket.on('end_call', async (data) => {
        try {
            const { sessionId } = data;
            const session = await sessionManager.getSession(sessionId);

            if (!session) {
                return socket.emit('call_error', { error: 'Session not found' });
            }
            if (session.callerId !== userId && session.hostId !== userId) {
                return socket.emit('call_error', { error: 'Not a participant' });
            }

            // Stop billing timer
            billingTimer.stop(sessionId);

            const answeredAt = session.answeredAt ? new Date(session.answeredAt) : null;
            const durationSeconds = answeredAt
                ? Math.floor((Date.now() - answeredAt.getTime()) / 1000)
                : 0;

            await sessionManager.updateSession(sessionId, {
                state: 'ENDED',
                endedAt: new Date().toISOString(),
                durationSeconds,
                terminationReason: userId === session.callerId ? 'CALLER_ENDED' : 'HOST_ENDED',
            });

            // Unlock users
            await sessionManager.unlockUser(session.callerId);
            await sessionManager.unlockUser(session.hostId);

            const totalCost = Math.ceil(durationSeconds / 60) * session.ratePerMinute;

            // Notify both parties
            io.to(`call:${sessionId}`).emit('call_ended', {
                sessionId,
                reason: userId === session.callerId ? 'CALLER_ENDED' : 'HOST_ENDED',
                durationSeconds,
                totalCost,
                ratePerMinute: session.ratePerMinute,
            });

            // Publish Kafka event
            await publishEvent('call.ended', {
                sessionId,
                callerId: session.callerId,
                hostId: session.hostId,
                durationSeconds,
                callType: session.callType,
                rateApplied: session.ratePerMinute,
                terminationReason: userId === session.callerId ? 'CALLER_ENDED' : 'HOST_ENDED',
            });

        } catch (err) {
            console.error('end_call error:', err);
            socket.emit('call_error', { error: 'Failed to end call' });
        }
    });

    // ─── WEBRTC SIGNALING RELAY ───
    // These events relay SDP offers/answers and ICE candidates between peers
    // so they can establish a direct peer-to-peer WebRTC audio connection.

    socket.on('webrtc_offer', (data) => {
        const { sessionId, sdp } = data;
        console.log(`WebRTC offer from ${userId} for session ${sessionId}`);
        // Forward to the other participant in the call room
        socket.to(`call:${sessionId}`).emit('webrtc_offer', {
            sessionId,
            sdp,
            fromUserId: userId,
        });
    });

    socket.on('webrtc_answer', (data) => {
        const { sessionId, sdp } = data;
        console.log(`WebRTC answer from ${userId} for session ${sessionId}`);
        socket.to(`call:${sessionId}`).emit('webrtc_answer', {
            sessionId,
            sdp,
            fromUserId: userId,
        });
    });

    socket.on('ice_candidate', (data) => {
        const { sessionId, candidate } = data;
        // Forward ICE candidate to the other peer
        socket.to(`call:${sessionId}`).emit('ice_candidate', {
            sessionId,
            candidate,
            fromUserId: userId,
        });
    });

    // ─── DISCONNECT ───
    socket.on('disconnect', () => {
        console.log(`Call socket disconnected: user ${userId}`);
    });
};
