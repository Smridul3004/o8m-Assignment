require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

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

// Routes will be added in Step 5
// app.use('/credits', require('./routes/credits'));
// app.use('/transactions', require('./routes/transactions'));
// app.use('/earnings', require('./routes/earnings'));

app.listen(PORT, () => {
    console.log(`Billing Service running on port ${PORT}`);
});

module.exports = app;
