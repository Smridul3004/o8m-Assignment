const { Kafka, logLevel } = require('kafkajs');

const kafka = new Kafka({
    clientId: 'chat-service',
    brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
    retry: { retries: 1 },
    connectionTimeout: 3000,
    logLevel: logLevel.WARN,
});

const producer = kafka.producer();

const connectProducer = async () => {
    try {
        await producer.connect();
        console.log('Chat Service Kafka producer connected');
    } catch (err) {
        console.warn('Kafka producer not available — notifications will not be sent');
    }
};

const publishEvent = async (topic, data) => {
    try {
        await producer.send({
            topic,
            messages: [{ value: JSON.stringify(data) }],
        });
    } catch (err) {
        console.warn(`Failed to publish to ${topic}:`, err.message);
    }
};

module.exports = { connectProducer, publishEvent };
