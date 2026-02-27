require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const { connectProducer, connectConsumer } = require('./config/kafka');
const callHandler = require('./socket/callHandler');
const callRoutes = require('./routes/calls');
const sessionManager = require('./services/sessionManager');
const billingTimer = require('./services/billingTimer');

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

// REST routes
app.use('/calls', callRoutes);

// Socket.io setup
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
});

// Redis adapter for Socket.io scalability
// Support REDIS_URL (Render/Heroku) or REDIS_HOST/REDIS_PORT (local)
const redisConfig = process.env.REDIS_URL
    ? process.env.REDIS_URL
    : {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
    };
const pubClient = new Redis(redisConfig);
const subClient = pubClient.duplicate();

Promise.all([pubClient.ping(), subClient.ping()])
    .then(() => {
        io.adapter(createAdapter(pubClient, subClient));
        console.log('Socket.io Redis adapter configured');
    })
    .catch(err => console.error('Redis adapter error:', err));

// Socket.io connection handler
io.on('connection', (socket) => {
    callHandler(io, socket);
});

// Kafka event handler for balance.depleted
const handleKafkaMessage = async (topic, data) => {
    if (topic === 'balance.depleted') {
        const { sessionId, callerId } = data;
        console.log(`Balance depleted event for session ${sessionId}`);

        const session = await sessionManager.getSession(sessionId);
        if (session && session.state === 'ACTIVE') {
            billingTimer.stop(sessionId);

            const answeredAt = new Date(session.answeredAt);
            const durationSeconds = Math.floor((Date.now() - answeredAt.getTime()) / 1000);

            await sessionManager.updateSession(sessionId, {
                state: 'ENDED',
                endedAt: new Date().toISOString(),
                durationSeconds,
                terminationReason: 'BALANCE_DEPLETED',
            });

            await sessionManager.unlockUser(session.callerId);
            await sessionManager.unlockUser(session.hostId);

            io.to(`call:${sessionId}`).emit('call_ended', {
                sessionId,
                reason: 'BALANCE_DEPLETED',
                durationSeconds,
                totalCost: Math.ceil(durationSeconds / 60) * session.ratePerMinute,
            });
        }
    }
};

// Start server
const start = async () => {
    try {
        await connectProducer();
        await connectConsumer(handleKafkaMessage);
    } catch (err) {
        console.error('Kafka connection error (non-fatal):', err.message);
    }

    server.listen(PORT, () => {
        console.log(`Call Service running on port ${PORT}`);
    });
};

start();

module.exports = { app, server, io };
