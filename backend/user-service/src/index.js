require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { startConsumer } = require('./config/kafka');
const profileRoutes = require('./routes/profile');

const app = express();
const PORT = process.env.USER_SERVICE_PORT || 3002;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'user-service' });
});

// Profile routes
app.use('/profile', profileRoutes);

// Start
const start = async () => {
    await connectDB();
    startConsumer(); // Non-blocking
    app.listen(PORT, () => {
        console.log(`User Service running on port ${PORT}`);
    });
};

start();

module.exports = app;
