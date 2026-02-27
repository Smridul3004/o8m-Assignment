const Redis = require('ioredis');

// Support REDIS_URL (Render/Heroku) or REDIS_HOST/REDIS_PORT (local)
const redisConfig = process.env.REDIS_URL
    ? process.env.REDIS_URL
    : {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        retryStrategy: (times) => Math.min(times * 100, 3000),
    };

const redis = new Redis(redisConfig);

redis.on('connect', () => console.log('Call Service connected to Redis'));
redis.on('error', (err) => console.error('Redis error:', err));

module.exports = redis;
