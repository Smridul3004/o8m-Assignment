require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

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

// Routes will be added in Step 4
// app.use('/hosts', require('./routes/hosts'));

app.listen(PORT, () => {
    console.log(`Discovery Service running on port ${PORT}`);
});

module.exports = app;
