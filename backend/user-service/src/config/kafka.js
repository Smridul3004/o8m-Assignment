const { Kafka, logLevel } = require('kafkajs');
const Profile = require('../models/Profile');

// Skip Kafka if not configured
const KAFKA_ENABLED = process.env.KAFKA_BROKERS && process.env.KAFKA_BROKERS !== 'localhost:9092';

let kafka, consumer;
if (KAFKA_ENABLED) {
    kafka = new Kafka({
        clientId: 'user-service',
        brokers: [process.env.KAFKA_BROKERS],
        retry: { retries: 1 },
        connectionTimeout: 3000,
        logLevel: logLevel.WARN,
    });
    consumer = kafka.consumer({ groupId: 'user-service-group' });
}

const startConsumer = async () => {
    if (!KAFKA_ENABLED) {
        console.log('Kafka not configured, skipping consumer');
        return;
    }
    try {
        await consumer.connect();
        await consumer.subscribe({ topic: 'user.registered', fromBeginning: true });

        await consumer.run({
            eachMessage: async ({ topic, message }) => {
                try {
                    const event = JSON.parse(message.value.toString());
                    console.log(`Received ${topic}:`, event);

                    if (topic === 'user.registered') {
                        const exists = await Profile.findOne({ userId: event.userId });
                        if (!exists) {
                            await Profile.create({
                                userId: event.userId,
                                email: event.email,
                                role: event.role,
                                displayName: event.email.split('@')[0],
                            });
                            console.log(`Profile created for user ${event.userId}`);
                        }
                    }
                } catch (err) {
                    console.error('Error processing message:', err);
                }
            },
        });

        console.log('Kafka consumer started');
    } catch (err) {
        console.warn('Kafka consumer not available — profiles created via API fallback');
    }
};

module.exports = { startConsumer };
