require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const { startKafkaConsumer } = require('./config/kafka');
const tokenRoutes = require('./routes/tokens');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || process.env.NOTIFICATION_SERVICE_PORT || 3007;
const MONGO_URI = process.env.NOTIFICATION_MONGO_URI || process.env.MONGO_URI || 'mongodb://mongo:27017/o8m_notifications';

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'notification-service' });
});

// Routes
app.use('/tokens', tokenRoutes);
app.use('/notifications', notificationRoutes);

// Connect MongoDB and start Kafka consumer
async function start() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Notification Service connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
    }

    // Start Kafka consumer (non-blocking)
    startKafkaConsumer().catch(err => {
        console.warn('Kafka consumer failed to start:', err.message);
    });

    app.listen(PORT, () => {
        console.log(`Notification Service running on port ${PORT}`);
    });
}

start();

module.exports = app;
