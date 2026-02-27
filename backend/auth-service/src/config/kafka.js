const { Kafka } = require('kafkajs');

// Skip Kafka entirely if not configured
const KAFKA_ENABLED = process.env.KAFKA_BROKER && process.env.KAFKA_BROKER !== 'localhost:9092';

let kafka, producer;
let isConnected = false;

if (KAFKA_ENABLED) {
    kafka = new Kafka({
        clientId: 'auth-service',
        brokers: [process.env.KAFKA_BROKER],
        retry: { retries: 1 },
        connectionTimeout: 3000,
    });
    producer = kafka.producer();
}

async function connectProducer() {
    if (!KAFKA_ENABLED) {
        console.log('Kafka not configured, skipping connection');
        return;
    }
    try {
        await producer.connect();
        isConnected = true;
        console.log('Kafka producer connected');
    } catch (err) {
        console.error('Kafka producer connection failed:', err.message);
        // Don't crash the service — Kafka is optional for basic auth to work
    }
}

async function publishEvent(topic, message) {
    if (!isConnected) {
        console.warn(`Kafka not connected, skipping event: ${topic}`);
        return;
    }
    try {
        await producer.send({
            topic,
            messages: [{ value: JSON.stringify(message) }],
        });
        console.log(`Event published to ${topic}:`, message);
    } catch (err) {
        console.error(`Failed to publish to ${topic}:`, err.message);
    }
}

module.exports = { connectProducer, publishEvent };
