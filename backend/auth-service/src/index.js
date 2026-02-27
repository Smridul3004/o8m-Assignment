require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const migrate = require('./migrations/001_create_tables');
const { connectProducer } = require('./config/kafka');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || process.env.AUTH_SERVICE_PORT || 3001;

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

// Start server FIRST for health checks, then run migrations
async function start() {
    // Start server immediately so health checks pass
    app.listen(PORT, () => {
        console.log(`Auth Service running on port ${PORT}`);
    });

    // Run migrations (don't block startup)
    try {
        await migrate();
        console.log('Database migrations complete');
        await connectProducer();
    } catch (err) {
        console.error('Auth Service initialization error:', err.message);
        // Service stays running for health checks
    }
}

start();

module.exports = app;
