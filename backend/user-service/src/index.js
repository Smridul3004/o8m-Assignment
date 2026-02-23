require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

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

// Routes will be added in Step 3
// app.use('/profile', require('./routes/profile'));

app.listen(PORT, () => {
    console.log(`User Service running on port ${PORT}`);
});

module.exports = app;
