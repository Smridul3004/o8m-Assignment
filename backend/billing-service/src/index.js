require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { initDB } = require('./config/db');
const walletRoutes = require('./routes/wallet');

const app = express();
const PORT = process.env.PORT || process.env.BILLING_SERVICE_PORT || 3006;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'billing-service' });
});

// Wallet & billing routes
app.use('/wallet', walletRoutes);

// Start server FIRST for health checks, then init DB
const start = async () => {
    // Start server immediately so health checks pass
    app.listen(PORT, () => {
        console.log(`Billing Service running on port ${PORT}`);
    });

    // Initialize database (don't block startup)
    try {
        await initDB();
        console.log('Database initialized');
    } catch (err) {
        console.error('Database initialization failed:', err.message);
        // Service stays running for health checks
    }
};

start();

module.exports = app;
