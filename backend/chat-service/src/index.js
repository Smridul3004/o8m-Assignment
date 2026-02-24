require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { connectProducer } = require('./config/kafka');
const messageRoutes = require('./routes/messages');
const chatHandler = require('./socket/chatHandler');

const app = express();
const server = http.createServer(app);

// Socket.io with CORS
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
    path: '/socket.io',
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'chat-service' });
});

// REST routes for message history & conversation management
app.use('/', messageRoutes);

// Socket.io handler
chatHandler(io);

// Start
const PORT = process.env.PORT || 3004;

const start = async () => {
    await connectDB();
    await connectProducer();

    server.listen(PORT, () => {
        console.log(`Chat Service running on port ${PORT}`);
    });
};

start();
