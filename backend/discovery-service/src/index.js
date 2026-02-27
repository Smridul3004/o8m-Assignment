require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const hostsRoutes = require('./routes/hosts');

const app = express();
const PORT = process.env.PORT || process.env.DISCOVERY_SERVICE_PORT || 3003;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'discovery-service' });
});

// Host discovery routes
app.use('/hosts', hostsRoutes);

// Start server FIRST for health checks, then connect DB
const start = async () => {
    // Start server immediately so health checks pass
    app.listen(PORT, () => {
        console.log(`Discovery Service running on port ${PORT}`);
    });

    // Connect to database (don't block startup)
    try {
        await connectDB();
        console.log('Database connected');
    } catch (err) {
        console.error('Database connection failed:', err.message);
        // Service stays running for health checks
    }
};

start();

module.exports = app;
