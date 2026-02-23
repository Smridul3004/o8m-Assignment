require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.AUTH_SERVICE_PORT || 3001;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'auth-service' });
});

// Routes will be added in Step 2
// app.use('/register', require('./routes/register'));
// app.use('/login', require('./routes/login'));
// app.use('/refresh', require('./routes/refresh'));
// app.use('/me', require('./routes/me'));

app.listen(PORT, () => {
    console.log(`Auth Service running on port ${PORT}`);
});

module.exports = app;
