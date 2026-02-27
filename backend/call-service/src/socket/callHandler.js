const axios = require('axios');
const sessionManager = require('../services/sessionManager');
const { generateAgoraToken } = require('../services/agoraTokenService');
const billingTimer = require('../services/billingTimer');
const { publishEvent } = require('../config/kafka');

const BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL || 'http://billing-service:3006';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:3002';
const CALL_TIMEOUT_MS = 30000; // 30 seconds to answer
const RECONNECT_WINDOW_MS = parseInt(process.env.RECONNECT_WINDOW_SECONDS || 10) * 1000;

// Track timeout timers: sessionId → timeoutId
const callTimeouts = new Map();
// Track reconnect timers: sessionId → timeoutId
const reconnectTimers = new Map();
// Track offline grace timers: userId → timeoutId (5 second grace before going offline)
const offlineGraceTimers = new Map();
const OFFLINE_GRACE_MS = 5000; // 5 seconds grace period for page refreshes

module.exports = function callHandler(io, socket) {
    const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
    if (!userId) {
        socket.disconnect();
        return;
    }

    // Join personal room for notifications
    socket.join(`user:${userId}`);
    console.log(`Call socket connected: user ${userId}`);

    // Cancel any pending offline grace timer (user reconnected quickly)
    const pendingOfflineTimer = offlineGraceTimers.get(userId);
    if (pendingOfflineTimer) {
        clearTimeout(pendingOfflineTimer);
        offlineGraceTimers.delete(userId);
        console.log(`Cancelled offline grace timer for ${userId} (reconnected)`);
    }

    // Auto-set availability to ONLINE when socket connects
    (async () => {
        try {
            await axios.put(`${USER_SERVICE_URL}/profile/availability`, { status: 'ONLINE' }, {
                headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
                timeout: 3000,
            });
            console.log(`User ${userId} availability → ONLINE`);
        } catch (err) {
            console.warn(`Failed to set ${userId} ONLINE:`, err.message);
        }
    })();

    // On reconnect, check if user has an active session and rejoin room
    (async () => {
        try {
            const activeSession = await sessionManager.findActiveSessionForUser(userId);
            if (activeSession && (activeSession.state === 'ACTIVE' || activeSession.state === 'RECONNECTING')) {
                socket.join(`call:${activeSession.sessionId}`);
                console.log(`User ${userId} rejoined call room: ${activeSession.sessionId}`);

                // If session was in RECONNECTING state, restore to ACTIVE
                if (activeSession.state === 'RECONNECTING') {
                    const reconnectTimer = reconnectTimers.get(activeSession.sessionId);
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimers.delete(activeSession.sessionId);
                    }
                    await sessionManager.updateSession(activeSession.sessionId, {
                        state: 'ACTIVE',
                    });
                    // Notify both parties of reconnection
                    io.to(`call:${activeSession.sessionId}`).emit('call_reconnected', {
                        sessionId: activeSession.sessionId,
                        reconnectedUserId: userId,
                    });
                    console.log(`Session ${activeSession.sessionId} restored from RECONNECTING to ACTIVE`);
                }
            }
        } catch (err) {
            console.error('Reconnect check error:', err.message);
        }
    })();

    // ─── INITIATE CALL ───
    socket.on('initiate_call', async (data) => {
        try {
            const { hostId, hostRate, callType, videoRate } = data;
            if (!hostId || hostRate == null || hostRate === undefined) {
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

            // Determine rate based on call type
            const effectiveCallType = callType || 'AUDIO';
            // Ensure we have a valid rate (fall back to 1.0 if host hasn't set rates)
            const baseRate = (hostRate && hostRate > 0) ? hostRate : 1.0;
            const effectiveRate = (effectiveCallType === 'VIDEO' && videoRate && videoRate > 0) ? videoRate : baseRate;

            console.log('initiate_call payload:', { userId, hostId, hostRate, callType, videoRate, baseRate, effectiveRate });

            // Pre-authorise billing (lock credits for 1 minute)
            let preAuthId;
            try {
                const billingPayload = {
                    callerId: userId,
                    hostId,
                    ratePerMinute: effectiveRate,
                };
                console.log('Sending to billing pre-auth:', billingPayload);
                const resp = await axios.post(`${BILLING_SERVICE_URL}/wallet/pre-auth`, billingPayload, {
                    headers: { 
                        'x-user-id': userId,
                        'Content-Type': 'application/json',
                    },
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
                callType: effectiveCallType,
                ratePerMinute: effectiveRate,
                audioRate: hostRate,
                videoRate: videoRate || (hostRate * 1.5),
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

            // Fetch caller display name for the host's incoming call screen
            let callerName = 'Unknown';
            try {
                const profileRes = await axios.get(
                    `${USER_SERVICE_URL}/profile/public/${userId}`,
                    { timeout: 2000 }
                );
                callerName = profileRes.data?.profile?.displayName || 'Unknown';
            } catch (e) {
                console.warn('Could not fetch caller name:', e.message);
            }

            // Notify host via their personal room
            io.to(`user:${hostId}`).emit('incoming_call', {
                sessionId: session.sessionId,
                callerId: userId,
                callerName,
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
            // Send detailed error for debugging
            const errMessage = err.response?.data?.error || err.message || 'Unknown error';
            socket.emit('call_error', { error: `Failed to initiate call: ${errMessage}` });
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

            // Notify both parties with callType info
            io.to(`user:${session.callerId}`).emit('call_accepted', {
                sessionId,
                agoraToken: callerToken,
                hostId: session.hostId,
                callType: session.callType,
                ratePerMinute: session.ratePerMinute,
                answeredAt: now,
            });

            socket.emit('call_accepted', {
                sessionId,
                agoraToken: hostToken,
                callerId: session.callerId,
                callType: session.callType,
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

            // Clear any reconnect timer
            const reconnTimer = reconnectTimers.get(sessionId);
            if (reconnTimer) {
                clearTimeout(reconnTimer);
                reconnectTimers.delete(sessionId);
            }

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
                callType: session.callType,
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

    // ─── AUDIO TO VIDEO UPGRADE ───
    socket.on('request_upgrade', async (data) => {
        try {
            const { sessionId } = data;
            const session = await sessionManager.getSession(sessionId);

            if (!session || session.state !== 'ACTIVE') {
                return socket.emit('call_error', { error: 'No active session to upgrade' });
            }
            if (session.callerId !== userId && session.hostId !== userId) {
                return socket.emit('call_error', { error: 'Not a participant' });
            }
            if (session.callType === 'VIDEO') {
                return socket.emit('call_error', { error: 'Already a video call' });
            }

            // Forward upgrade request to the other party
            const otherUserId = session.callerId === userId ? session.hostId : session.callerId;
            io.to(`user:${otherUserId}`).emit('upgrade_requested', {
                sessionId,
                fromUserId: userId,
                requestedType: 'VIDEO',
            });

            socket.emit('upgrade_request_sent', { sessionId });
        } catch (err) {
            console.error('request_upgrade error:', err);
            socket.emit('call_error', { error: 'Failed to request upgrade' });
        }
    });

    socket.on('accept_upgrade', async (data) => {
        try {
            const { sessionId } = data;
            const session = await sessionManager.getSession(sessionId);

            if (!session || session.state !== 'ACTIVE') {
                return socket.emit('call_error', { error: 'No active session' });
            }

            // Switch to video rate
            const videoRate = session.videoRate || (session.ratePerMinute * 1.5);
            await sessionManager.updateSession(sessionId, {
                callType: 'VIDEO',
                ratePerMinute: videoRate,
            });

            // Notify both parties
            io.to(`call:${sessionId}`).emit('upgrade_accepted', {
                sessionId,
                callType: 'VIDEO',
                ratePerMinute: videoRate,
            });

            console.log(`Session ${sessionId} upgraded to VIDEO at rate ${videoRate}`);
        } catch (err) {
            console.error('accept_upgrade error:', err);
            socket.emit('call_error', { error: 'Failed to accept upgrade' });
        }
    });

    socket.on('decline_upgrade', async (data) => {
        try {
            const { sessionId } = data;
            const session = await sessionManager.getSession(sessionId);
            if (!session) return;

            const otherUserId = session.callerId === userId ? session.hostId : session.callerId;
            io.to(`user:${otherUserId}`).emit('upgrade_declined', {
                sessionId,
            });
        } catch (err) {
            console.error('decline_upgrade error:', err);
        }
    });

    // ─── TOKEN REFRESH ───
    socket.on('refresh_token', async (data) => {
        try {
            const { sessionId } = data;
            const session = await sessionManager.getSession(sessionId);

            if (!session || session.state !== 'ACTIVE') {
                return socket.emit('call_error', { error: 'No active session' });
            }
            if (session.callerId !== userId && session.hostId !== userId) {
                return socket.emit('call_error', { error: 'Not a participant' });
            }

            const uid = session.callerId === userId ? 1 : 2;
            const newToken = generateAgoraToken(sessionId, uid);

            socket.emit('token_refreshed', {
                sessionId,
                agoraToken: newToken,
            });
        } catch (err) {
            console.error('refresh_token error:', err);
            socket.emit('call_error', { error: 'Failed to refresh token' });
        }
    });

    // ─── WEBRTC SIGNALING RELAY ───
    socket.on('webrtc_offer', (data) => {
        const { sessionId, sdp } = data;
        console.log(`WebRTC offer from ${userId} for session ${sessionId}`);
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
        socket.to(`call:${sessionId}`).emit('ice_candidate', {
            sessionId,
            candidate,
            fromUserId: userId,
        });
    });

    // ─── DISCONNECT — RECONNECT WINDOW ───
    socket.on('disconnect', async () => {
        console.log(`Call socket disconnected: user ${userId}`);

        // Set user availability to OFFLINE after grace period (unless in an active call → stays IN_CALL)
        try {
            const activeSession = await sessionManager.findActiveSessionForUser(userId);
            if (!activeSession || activeSession.state !== 'ACTIVE') {
                // Use grace period to avoid flashing offline during page refreshes
                const graceTimer = setTimeout(async () => {
                    offlineGraceTimers.delete(userId);
                    try {
                        await axios.put(`${USER_SERVICE_URL}/profile/availability`, { status: 'OFFLINE' }, {
                            headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
                            timeout: 3000,
                        });
                        console.log(`User ${userId} availability → OFFLINE (after grace period)`);
                    } catch (err) {
                        console.warn(`Failed to set ${userId} OFFLINE:`, err.message);
                    }
                }, OFFLINE_GRACE_MS);
                offlineGraceTimers.set(userId, graceTimer);
                console.log(`Started offline grace timer for ${userId}`);
            }

            if (activeSession && activeSession.state === 'ACTIVE') {
                // Transition to RECONNECTING
                await sessionManager.updateSession(activeSession.sessionId, {
                    state: 'RECONNECTING',
                });

                // Notify the other party
                io.to(`call:${activeSession.sessionId}`).emit('peer_reconnecting', {
                    sessionId: activeSession.sessionId,
                    disconnectedUserId: userId,
                });

                console.log(`Session ${activeSession.sessionId} → RECONNECTING (${userId} disconnected)`);

                // Start reconnect window timer
                const reconnectTimeout = setTimeout(async () => {
                    reconnectTimers.delete(activeSession.sessionId);
                    const sess = await sessionManager.getSession(activeSession.sessionId);
                    if (sess && sess.state === 'RECONNECTING') {
                        console.log(`Reconnect timeout for session ${activeSession.sessionId} — ending call`);

                        billingTimer.stop(activeSession.sessionId);

                        const answeredAt = sess.answeredAt ? new Date(sess.answeredAt) : null;
                        const durationSeconds = answeredAt
                            ? Math.floor((Date.now() - answeredAt.getTime()) / 1000)
                            : 0;

                        await sessionManager.updateSession(activeSession.sessionId, {
                            state: 'ENDED',
                            endedAt: new Date().toISOString(),
                            durationSeconds,
                            terminationReason: 'RECONNECT_TIMEOUT',
                        });

                        await sessionManager.unlockUser(sess.callerId);
                        await sessionManager.unlockUser(sess.hostId);

                        const totalCost = Math.ceil(durationSeconds / 60) * sess.ratePerMinute;

                        io.to(`call:${activeSession.sessionId}`).emit('call_ended', {
                            sessionId: activeSession.sessionId,
                            reason: 'RECONNECT_TIMEOUT',
                            durationSeconds,
                            totalCost,
                            ratePerMinute: sess.ratePerMinute,
                        });

                        await publishEvent('call.ended', {
                            sessionId: activeSession.sessionId,
                            callerId: sess.callerId,
                            hostId: sess.hostId,
                            durationSeconds,
                            callType: sess.callType,
                            rateApplied: sess.ratePerMinute,
                            terminationReason: 'RECONNECT_TIMEOUT',
                        });
                    }
                }, RECONNECT_WINDOW_MS);

                reconnectTimers.set(activeSession.sessionId, reconnectTimeout);
            }
        } catch (err) {
            console.error('Disconnect handler error:', err.message);
        }
    });
};
