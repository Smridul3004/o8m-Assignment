require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const server = http.createServer(app);
const PORT = process.env.CALL_SERVICE_PORT || 3005;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'call-service' });
});

// Socket.io, Agora, and routes will be added in Step 7

server.listen(PORT, () => {
    console.log(`Call Service running on port ${PORT}`);
});

module.exports = { app, server };
