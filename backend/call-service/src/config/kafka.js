const { Kafka } = require('kafkajs');

const kafka = new Kafka({
    clientId: 'call-service',
    brokers: [process.env.KAFKA_BROKER || 'kafka:9092'],
    retry: { retries: 5, initialRetryTime: 1000 },
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'call-service-group' });

const connectProducer = async () => {
    await producer.connect();
    console.log('Call Service Kafka producer connected');
};

const connectConsumer = async (messageHandler) => {
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
