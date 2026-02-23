const { Kafka } = require('kafkajs');

const kafka = new Kafka({
    clientId: 'auth-service',
    brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const producer = kafka.producer();
let isConnected = false;

async function connectProducer() {
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
