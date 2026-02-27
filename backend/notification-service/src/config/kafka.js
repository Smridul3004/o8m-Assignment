const { Kafka, logLevel } = require('kafkajs');
const Notification = require('../models/Notification');
const { sendPushToUser } = require('./push');

// Skip Kafka if not configured
const KAFKA_ENABLED = process.env.KAFKA_BROKERS && process.env.KAFKA_BROKERS !== 'localhost:9092';

let kafka, consumer;
if (KAFKA_ENABLED) {
    kafka = new Kafka({
        clientId: 'notification-service',
        brokers: [process.env.KAFKA_BROKERS],
        retry: { retries: 2 },
        connectionTimeout: 3000,
        logLevel: logLevel.WARN,
    });
    consumer = kafka.consumer({ groupId: 'notification-group' });
}

/**
 * Map Kafka topics to notification builders.
 */
const topicHandlers = {
    'call.initiated': async (payload) => ({
        recipientId: payload.hostId,
        type: 'INCOMING_CALL',
        title: 'Incoming Call',
        body: `${payload.callerName || 'Someone'} is calling you (${payload.callType || 'AUDIO'})`,
        data: { sessionId: payload.sessionId, callType: payload.callType },
    }),

    'call.ended': async (payload) => {
        // Notify both parties
        const notifications = [];
        if (payload.callerId) {
            notifications.push({
                recipientId: payload.callerId,
                type: 'CALL_ENDED',
                title: 'Call Ended',
                body: `Call lasted ${Math.ceil((payload.durationSeconds || 0) / 60)} min`,
                data: { sessionId: payload.sessionId, durationSeconds: payload.durationSeconds },
            });
        }
        if (payload.hostId) {
            notifications.push({
                recipientId: payload.hostId,
                type: 'CALL_ENDED',
                title: 'Call Ended',
                body: `Call lasted ${Math.ceil((payload.durationSeconds || 0) / 60)} min`,
                data: { sessionId: payload.sessionId, durationSeconds: payload.durationSeconds },
            });
        }
        return notifications;
    },

    'message.received': async (payload) => ({
        recipientId: payload.recipientId,
        type: 'NEW_MESSAGE',
        title: 'New Message',
        body: payload.content ? payload.content.substring(0, 100) : 'You have a new message',
        data: { conversationId: payload.conversationId, senderId: payload.senderId },
    }),
};

async function startKafkaConsumer() {
    if (!KAFKA_ENABLED) {
        console.log('Kafka not configured, skipping consumer');
        return;
    }
    await consumer.connect();
    console.log('Notification Kafka consumer connected');

    const topics = Object.keys(topicHandlers);
    await consumer.subscribe({ topics, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, message }) => {
            try {
                const payload = JSON.parse(message.value.toString());
                const handler = topicHandlers[topic];
                if (!handler) return;

                const result = await handler(payload);
                const notifications = Array.isArray(result) ? result : [result];

                for (const notif of notifications) {
                    if (!notif || !notif.recipientId) continue;

                    // Save to database
                    const saved = await Notification.create(notif);

                    // Attempt push delivery
                    try {
                        await sendPushToUser(notif.recipientId, {
                            title: notif.title,
                            body: notif.body,
                            data: notif.data || {},
                        });
                        saved.delivered = true;
                        await saved.save();
                    } catch (pushErr) {
                        console.warn(`Push delivery failed for ${notif.recipientId}:`, pushErr.message);
                    }
                }
            } catch (err) {
                console.error(`Error processing ${topic}:`, err.message);
            }
        },
    });

    console.log(`Notification consumer subscribed to: ${topics.join(', ')}`);
}

module.exports = { startKafkaConsumer };
