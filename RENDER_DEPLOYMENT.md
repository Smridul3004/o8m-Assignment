# O8M Marketplace - Render Deployment Guide

This guide explains how to deploy the O8M Marketplace to Render.

## Prerequisites

1. [GitHub account](https://github.com) with the repository pushed
2. [Render account](https://render.com)
3. [MongoDB Atlas account](https://mongodb.com/atlas) (free tier available)
4. [Upstash account](https://upstash.com) for Redis (free tier available)

## Step 1: Setup External Services

### MongoDB Atlas (Free Tier)
1. Go to [MongoDB Atlas](https://mongodb.com/atlas)
2. Create a free cluster (M0 Sandbox)
3. Create a database user with read/write access
4. Whitelist IP: `0.0.0.0/0` (allow from anywhere)
5. Get your connection string: `mongodb+srv://smridul779:avzfc5ca@o8m.wvbnlyx.mongodb.net/`

### Upstash Redis (Free Tier)
1. Go to [Upstash](https://upstash.com)
2. Create a Redis database
3. Get the connection string (REDIS_URL): `REDIS_URL="rediss://default:AfA4AAIncDEwOWM1M2U0ZjBjYmU0YjgzOGJhMzJhYzdjMWM0NTBmZXAxNjE0OTY@busy-rabbit-61496.upstash.io:6379"`

### Kafka (Optional - Skip for Now)
Kafka is **optional** in this project. All services handle Kafka connection failures gracefully and continue working without it. Core functionality works fine.

If you need Kafka later:
- [Confluent Cloud](https://confluent.cloud) - free tier: 400 MB/month
- [Redpanda Cloud](https://redpanda.com/cloud) - free tier available

## Step 2: Deploy Backend Services to Render

### Option A: Using Render Blueprint (Recommended)
1. Push your code to GitHub
2. Go to Render Dashboard → "New" → "Blueprint"
3. Connect your GitHub repository
4. Render will read `render.yaml` and create all services
5. Fill in the environment variables marked as `sync: false`:
   - `MONGODB_URI`: Your MongoDB Atlas connection string
   - `REDIS_URL`: Your Upstash Redis connection string

### Option B: Manual Deployment

#### Deploy each service manually:

**1. Auth Service**
- Type: Web Service
- Build: Docker
- Dockerfile Path: `./backend/auth-service/Dockerfile`
- Environment Variables:
  ```
  NODE_ENV=production
  PORT=3001
  JWT_SECRET=<generate-a-long-secret>
  JWT_EXPIRES_IN=7d
  DATABASE_URL=<render-postgres-connection-string>
  ```

**2. User Service**
- Type: Web Service
- Build: Docker
- Environment Variables:
  ```
  NODE_ENV=production
  PORT=3002
  MONGO_URI=<mongodb-atlas-connection-string>
  ```

**3. Discovery Service**
- Type: Web Service
- Build: Docker
- Environment Variables:
  ```
  NODE_ENV=production
  PORT=3003
  MONGO_URI=<mongodb-atlas-connection-string>
  REDIS_URL=<upstash-redis-url>
  ```

**4. Chat Service**
- Type: Web Service
- Build: Docker
- Environment Variables:
  ```
  NODE_ENV=production
  PORT=3004
  MONGO_URI=<mongodb-atlas-connection-string>
  REDIS_URL=<upstash-redis-url>
  ```

**5. Call Service**
- Type: Web Service
- Build: Docker
- Environment Variables:
  ```
  NODE_ENV=production
  PORT=3005
  REDIS_URL=<upstash-redis-url>
  AGORA_APP_ID=8140f62fea4f4f2b9bebaecd2b07ebb4
  AGORA_APP_CERTIFICATE=7e70d82434d146f58227dc5e3f473238
  USER_SERVICE_URL=https://o8m-user-service.onrender.com
  BILLING_SERVICE_URL=https://o8m-billing-service.onrender.com
  ```

**6. Billing Service**
- Type: Web Service
- Build: Docker
- Environment Variables:
  ```
  NODE_ENV=production
  PORT=3006
  DATABASE_URL=<render-postgres-connection-string>
  ```

**7. Notification Service**
- Type: Web Service
- Build: Docker
- Environment Variables:
  ```
  NODE_ENV=production
  PORT=3007
  MONGO_URI=<mongodb-atlas-connection-string>
  ```

## Step 3: Deploy Render Managed Databases

### PostgreSQL (for auth-service, billing-service)
1. Render Dashboard → "New" → "PostgreSQL"
2. Choose Free plan
3. Note the connection strings (Internal and External)
4. Use Internal connection string for services on Render

### Redis (for call-service, discovery-service, chat-service)
**Option A**: Use Render Redis
1. Render Dashboard → "New" → "Redis"
2. Choose Free plan
3. Use the connection string

**Option B**: Use Upstash Redis (recommended for free tier limits)

## Step 4: Deploy Frontend (Flutter Web)

### Option A: Deploy Pre-built Static Site

1. Build locally with production URLs:
```powershell
cd client
flutter build web --release \
  --dart-define=AUTH_URL=https://o8m-auth-service.onrender.com \
  --dart-define=USER_URL=https://o8m-user-service.onrender.com \
  --dart-define=DISCOVERY_URL=https://o8m-discovery-service.onrender.com \
  --dart-define=CHAT_URL=https://o8m-chat-service.onrender.com \
  --dart-define=CALL_URL=https://o8m-call-service.onrender.com \
  --dart-define=BILLING_URL=https://o8m-billing-service.onrender.com
```

2. On Render:
   - New → Static Site
   - Connect GitHub repo
   - Build Command: `echo "Pre-built"`
   - Publish Directory: `client/build/web`

Note: You'll need to commit the `build/web` folder or use CI/CD.

### Option B: Use Netlify or Vercel for Frontend

These platforms have better Flutter support:

**Netlify:**
1. Push `client/build/web` to a separate branch or repo
2. Deploy as static site

**Vercel:**
1. Same as Netlify

### Option C: GitHub Actions CI/CD

Create `.github/workflows/deploy-frontend.yml`:
```yaml
name: Deploy Frontend

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.24.0'
      
      - name: Build Flutter Web
        working-directory: ./client
        run: |
          flutter pub get
          flutter build web --release \
            --dart-define=AUTH_URL=${{ secrets.AUTH_URL }} \
            --dart-define=USER_URL=${{ secrets.USER_URL }} \
            --dart-define=DISCOVERY_URL=${{ secrets.DISCOVERY_URL }} \
            --dart-define=CHAT_URL=${{ secrets.CHAT_URL }} \
            --dart-define=CALL_URL=${{ secrets.CALL_URL }} \
            --dart-define=BILLING_URL=${{ secrets.BILLING_URL }}
      
      - name: Deploy to Render
        # Use Render Deploy Hook or commit to deploy branch
```

## Step 5: Update CORS Settings

Once all services are deployed, update CORS in each service to allow the frontend URL:

In each service's `index.js`, update:
```javascript
app.use(cors({
  origin: [
    'http://localhost:8080',
    'https://o8m-frontend.onrender.com', // Your frontend URL
  ],
  credentials: true
}));
```

## Environment Variables Summary

| Service | Variables |
|---------|-----------|
| auth-service | DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN |
| user-service | MONGO_URI |
| discovery-service | MONGO_URI, REDIS_URL |
| chat-service | MONGO_URI, REDIS_URL |
| call-service | REDIS_URL, AGORA_APP_ID, AGORA_APP_CERTIFICATE, USER_SERVICE_URL, BILLING_SERVICE_URL |
| billing-service | DATABASE_URL |
| notification-service | MONGO_URI |

## Testing

1. Open your frontend URL: `https://o8m-frontend.onrender.com`
2. Register as a Host on one device
3. Register as a Caller on another device
4. Test calling functionality

## Troubleshooting

### Services not starting
- Check Render logs for each service
- Verify all environment variables are set
- Ensure DATABASE_URL/MONGO_URI are correct

### CORS errors
- Update CORS origin in backend services
- Redeploy after changes

### WebSocket not connecting
- Ensure call-service and chat-service are using HTTPS
- Check browser console for connection errors

### Free tier limitations
- Render free tier services spin down after 15 minutes of inactivity
- First request after spin-down takes ~30 seconds
- Consider upgrading for production use
