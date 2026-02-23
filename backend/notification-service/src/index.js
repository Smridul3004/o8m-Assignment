require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.NOTIFICATION_SERVICE_PORT || 3007;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'notification-service' });
});

// Routes will be added later
// app.use('/tokens', require('./routes/tokens'));

app.listen(PORT, () => {
    console.log(`Notification Service running on port ${PORT}`);
});

module.exports = app;
