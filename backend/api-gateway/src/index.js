require('dotenv').config();
const express = require('express');
const cors = require('cors'); // cors is used to enable cross-origin resource sharing
const helmet = require('helmet'); // helmet is used to set various HTTP headers to protect against common web vulnerabilities
const morgan = require('morgan'); // morgan is used to log HTTP requests
const { createProxyMiddleware } = require('http-proxy-middleware'); // createProxyMiddleware is used to proxy requests to downstream services
const rateLimit = require('express-rate-limit'); // rateLimit is used to limit the number of requests from a single IP address
const { verifyToken } = require('./middleware/auth'); // verifyToken is used to verify JWT tokens

const app = express();
const PORT = process.env.API_GATEWAY_PORT || 3000;

// --- Middleware ---
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json()); // express.json() is used to parse JSON bodies from requests

// --- Rate Limiting ---
// rateLimit is used to limit the number of requests from a single IP address
// windowMs is the time window in milliseconds
// max is the maximum number of requests allowed in the time window
// message is the message to be sent if the rate limit is exceeded
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter); // apply rate limiting to all requests

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
});

// --- Service Routes (proxy to microservices) ---
const services = {
  '/api/auth': process.env.AUTH_SERVICE_URL || 'http://auth-service:3001',
  '/api/users': process.env.USER_SERVICE_URL || 'http://user-service:3002',
  '/api/discovery': process.env.DISCOVERY_SERVICE_URL || 'http://discovery-service:3003',
  '/api/chat': process.env.CHAT_SERVICE_URL || 'http://chat-service:3004',
  '/api/calls': process.env.CALL_SERVICE_URL || 'http://call-service:3005',
  '/api/billing': process.env.BILLING_SERVICE_URL || 'http://billing-service:3006',
  '/api/notifications': process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3007',
};

// Public routes (no auth required)
const publicPaths = ['/api/auth/register', '/api/auth/login', '/api/auth/refresh'];

// Apply auth middleware to all /api routes except public paths
app.use('/api', (req, res, next) => {
  const fullPath = req.originalUrl.split('?')[0];
  if (publicPaths.some((p) => fullPath.startsWith(p))) {
    return next();
  }
  return verifyToken(req, res, next);
});

// Set up proxy for each service
Object.entries(services).forEach(([path, target]) => {
  app.use(
    path,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: { [`^${path}`]: '' },
      onProxyReq: (proxyReq, req) => {
        // Forward user info from JWT to downstream services
        if (req.user) {
          proxyReq.setHeader('X-User-Id', req.user.id);
          proxyReq.setHeader('X-User-Role', req.user.role);
        }
        // Forward body for POST/PUT/PATCH
        if (req.body && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },
    })
  );
});

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// --- Error Handler ---
app.use((err, req, res, next) => {
  console.error('Gateway error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
