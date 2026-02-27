const { Kafka } = require('kafkajs');

// Skip Kafka if not configured
const KAFKA_ENABLED = process.env.KAFKA_BROKER && process.env.KAFKA_BROKER !== 'kafka:9092' && process.env.KAFKA_BROKER !== 'localhost:9092';

let kafka, producer, consumer;
if (KAFKA_ENABLED) {
    kafka = new Kafka({
        clientId: 'call-service',
        brokers: [process.env.KAFKA_BROKER],
        retry: { retries: 2, initialRetryTime: 1000 },
    });
    producer = kafka.producer();
    consumer = kafka.consumer({ groupId: 'call-service-group' });
}

const connectProducer = async () => {
    if (!KAFKA_ENABLED) {
        console.log('Kafka not configured, skipping producer');
        return;
    }
    await producer.connect();
    console.log('Call Service Kafka producer connected');
};

const connectConsumer = async (messageHandler) => {
    if (!KAFKA_ENABLED) {
        console.log('Kafka not configured, skipping consumer');
        return;
    }
    await consumer.connect();
    await consumer.subscribe({ topic: 'balance.depleted', fromBeginning: false });
    await consumer.run({
        eachMessage: async ({ topic, message }) => {
            const data = JSON.parse(message.value.toString());
            messageHandler(topic, data);
        },
    });
    console.log('Call Service Kafka consumer listening on balance.depleted');
};

const publishEvent = async (topic, data) => {
    if (!KAFKA_ENABLED) return;
    try {
        await producer.send({
            topic,
            messages: [{ value: JSON.stringify(data) }],
        });
    } catch (err) {
        console.error(`Failed to publish to ${topic}:`, err);
    }
};

module.exports = { connectProducer, connectConsumer, publishEvent };
