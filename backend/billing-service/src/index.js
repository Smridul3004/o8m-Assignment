require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { initDB } = require('./config/db');
const walletRoutes = require('./routes/wallet');

const app = express();
const PORT = process.env.BILLING_SERVICE_PORT || 3006;

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

const start = async () => {
    await initDB();
    app.listen(PORT, () => {
        console.log(`Billing Service running on port ${PORT}`);
    });
};

start();

module.exports = app;
