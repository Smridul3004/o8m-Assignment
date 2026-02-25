const Redis = require('ioredis');

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('connect', () => console.log('Call Service connected to Redis'));
redis.on('error', (err) => console.error('Redis error:', err));

module.exports = redis;
