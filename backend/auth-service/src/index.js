require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const migrate = require('./migrations/001_create_tables');
const { connectProducer } = require('./config/kafka');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.AUTH_SERVICE_PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'auth-service' });
});

// Routes
app.use('/', authRoutes);

// Start server
async function start() {
    try {
        // Run database migrations
        await migrate();
        console.log('Database migrations complete');

        // Connect Kafka producer (non-blocking — service works without Kafka)
        await connectProducer();

        app.listen(PORT, () => {
            console.log(`Auth Service running on port ${PORT}`);
        });
    } catch (err) {
        console.error('Auth Service failed to start:', err.message);
        process.exit(1);
    }
}

start();

module.exports = app;
