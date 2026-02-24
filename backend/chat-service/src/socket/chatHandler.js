const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { publishEvent } = require('../config/kafka');

const BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL || 'http://billing-service:3006';

module.exports = function chatHandler(io) {
    io.on('connection', (socket) => {
        const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
        if (!userId) {
            socket.disconnect(true);
            return;
        }

        console.log(`User connected: ${userId}`);

        // Join user's personal room for direct delivery
        socket.join(`user:${userId}`);

        // ─── Join conversation room ───
        socket.on('join_conversation', async (data) => {
            try {
                const { conversationId } = data;
                if (!conversationId) return;

                const convo = await Conversation.findById(conversationId);
                if (!convo) {
                    socket.emit('error_event', { message: 'Conversation not found' });
                    return;
                }

                // Verify user is part of the conversation
                if (convo.callerId !== userId && convo.hostId !== userId) {
                    socket.emit('error_event', { message: 'Not authorized' });
                    return;
                }

                socket.join(`convo:${conversationId}`);
                socket.emit('joined_conversation', { conversationId });
            } catch (err) {
                console.error('Join conversation error:', err.message);
                socket.emit('error_event', { message: 'Failed to join conversation' });
            }
        });

        // ─── Send message ───
        socket.on('send_message', async (data) => {
            try {
                const { conversationId, content, idempotencyKey } = data;
                if (!conversationId || !content || !idempotencyKey) {
                    socket.emit('error_event', { message: 'Missing required fields' });
                    return;
                }

                // Reject duplicate messages
                const existing = await Message.findOne({ idempotencyKey });
                if (existing) {
                    socket.emit('message_sent', {
                        message: existing,
                        duplicate: true,
                    });
                    return;
                }

                // Get conversation
                const convo = await Conversation.findById(conversationId);
                if (!convo) {
                    socket.emit('error_event', { message: 'Conversation not found' });
                    return;
                }

                // Verify sender is part of conversation
                if (convo.callerId !== userId && convo.hostId !== userId) {
                    socket.emit('error_event', { message: 'Not authorized' });
                    return;
                }

                // Determine if sender is the Caller → needs billing
                const senderIsCaller = convo.callerId === userId;
                if (senderIsCaller) {
                    try {
                        const billingRes = await axios.post(
                            `${BILLING_SERVICE_URL}/wallet/deduct-message`,
                            {
                                callerId: convo.callerId,
                                hostId: convo.hostId,
                            },
                            { timeout: 5000 }
                        );

                        if (billingRes.data?.error) {
                            socket.emit('message_error', {
                                idempotencyKey,
                                error: billingRes.data.error,
                                code: 'INSUFFICIENT_BALANCE',
                            });
                            return;
                        }
                    } catch (billingErr) {
                        const errMsg = billingErr.response?.data?.error || 'Billing service unavailable';
                        const code = billingErr.response?.status === 402 ? 'INSUFFICIENT_BALANCE' : 'BILLING_ERROR';
                        socket.emit('message_error', {
                            idempotencyKey,
                            error: errMsg,
                            code,
                        });
                        return;
                    }
                }

                // Save message with server timestamp
                const message = await Message.create({
                    conversationId,
                    senderId: userId,
                    content: content.trim(),
                    idempotencyKey,
                    status: 'SENT',
                    serverTimestamp: new Date(),
                });

                // Update conversation last message
                convo.lastMessageAt = message.serverTimestamp;
                convo.lastMessagePreview = content.substring(0, 100);
                await convo.save();

                // Emit to the conversation room (all participants)
                io.to(`convo:${conversationId}`).emit('new_message', {
                    message: message.toObject(),
                });

                // Also emit to the other user's personal room (in case they haven't joined the convo room)
                const recipientId = convo.callerId === userId ? convo.hostId : convo.callerId;
                io.to(`user:${recipientId}`).emit('new_message_notification', {
                    conversationId,
                    message: message.toObject(),
                    senderName: userId, // Client should resolve display name
                });

                // Acknowledge to sender
                socket.emit('message_sent', {
                    message: message.toObject(),
                    duplicate: false,
                });

                // Publish Kafka event for push notifications
                await publishEvent('message.received', {
                    conversationId,
                    messageId: message._id.toString(),
                    senderId: userId,
                    recipientId,
                    content: content.substring(0, 100),
                    timestamp: message.serverTimestamp.toISOString(),
                });

            } catch (err) {
                console.error('Send message error:', err.message);
                socket.emit('error_event', { message: 'Failed to send message' });
            }
        });

        // ─── Message delivered acknowledgement ───
        socket.on('message_delivered', async (data) => {
            try {
                const { messageId } = data;
                const msg = await Message.findById(messageId);
                if (msg && msg.status === 'SENT') {
                    msg.status = 'DELIVERED';
                    await msg.save();
                    // Notify sender about delivery
                    io.to(`user:${msg.senderId}`).emit('message_status_update', {
                        messageId: msg._id,
                        conversationId: msg.conversationId,
                        status: 'DELIVERED',
                    });
                }
            } catch (err) {
                console.error('Message delivered error:', err.message);
            }
        });

        // ─── Message read acknowledgement ───
        socket.on('message_read', async (data) => {
            try {
                const { messageId } = data;
                const msg = await Message.findById(messageId);
                if (msg && msg.status !== 'READ') {
                    msg.status = 'READ';
                    await msg.save();
                    io.to(`user:${msg.senderId}`).emit('message_status_update', {
                        messageId: msg._id,
                        conversationId: msg.conversationId,
                        status: 'READ',
                    });
                }
            } catch (err) {
                console.error('Message read error:', err.message);
            }
        });

        // ─── Typing indicator ───
        socket.on('typing', (data) => {
            const { conversationId } = data;
            if (conversationId) {
                socket.to(`convo:${conversationId}`).emit('user_typing', {
                    conversationId,
                    userId,
                });
            }
        });

        socket.on('stop_typing', (data) => {
            const { conversationId } = data;
            if (conversationId) {
                socket.to(`convo:${conversationId}`).emit('user_stop_typing', {
                    conversationId,
                    userId,
                });
            }
        });

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${userId}`);
        });
    });
};
