require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const hostsRoutes = require('./routes/hosts');

const app = express();
const PORT = process.env.DISCOVERY_SERVICE_PORT || 3003;

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

const start = async () => {
    await connectDB();
    app.listen(PORT, () => {
        console.log(`Discovery Service running on port ${PORT}`);
    });
};

start();

module.exports = app;
