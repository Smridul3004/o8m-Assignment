# o8m Marketplace — Real-Time Communication Platform

A two-sided real-time communication marketplace connecting **Callers** (consumers) with **Hosts** (experts). Callers browse host profiles, initiate audio/video calls or send paid messages, with per-minute billing and a credit-based economy.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Flutter Web Client (Dart)                    │
│  Provider state · Agora JS interop · Socket.io-client           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP / WebSocket
                ┌───────────▼───────────┐
                │     API Gateway       │ :3000
                │    (Express proxy)    │
                └───────────┬───────────┘
       ┌──────────┬────────┬┴────────┬──────────┬──────────┐
       ▼          ▼        ▼         ▼          ▼          ▼
  Auth Svc   User Svc  Discovery  Chat Svc  Call Svc  Billing Svc
   :3001      :3002     :3003      :3004     :3005      :3006
  (PG/JWT)   (Mongo)   (Mongo)  (Mongo+WS) (Redis+WS)   (PG)
       │          │        │         │          │          │
       └──────────┴────────┴─────────┴──────┬───┴──────────┘
                                            │
                                     ┌──────▼──────┐
                                     │   Kafka     │
                                     │  (Events)   │
                                     └──────┬──────┘
                                            │
                                  ┌─────────▼─────────┐
                                  │ Notification Svc  │ :3007
                                  │  (Mongo + FCM)    │
                                  └───────────────────┘
```

### Services

| Service | Port | Database | Purpose |
|---------|------|----------|---------|
| **API Gateway** | 3000 | — | Routes HTTP requests to services, auth middleware |
| **Auth Service** | 3001 | PostgreSQL | Registration, JWT login, token refresh |
| **User Service** | 3002 | MongoDB | Profile CRUD, rates, availability status |
| **Discovery Service** | 3003 | MongoDB | Host browsing, search, filtering |
| **Chat Service** | 3004 | MongoDB | Conversations, messages, typing indicators (Socket.io) |
| **Call Service** | 3005 | Redis | Call signaling, Agora token generation, session state (Socket.io) |
| **Billing Service** | 3006 | PostgreSQL | Wallet, credits, per-minute deductions, host earnings, platform ledger |
| **Notification Service** | 3007 | MongoDB | Push token storage, Kafka consumer, FCM delivery |

### Infrastructure

- **PostgreSQL 16** — Auth (users, refresh_tokens) + Billing (wallets, transactions, platform_ledger)
- **MongoDB 7** — User profiles, chat messages, conversations, discovery cache, notifications
- **Redis 7** — Call session state, Socket.io adapter
- **Kafka (Confluent 7.5)** — Inter-service events (`call.initiated`, `call.ended`, `message.received`)
- **Agora Web SDK 4.23.1** — Real-time audio/video via CDN + JS interop

---

## Call Flow

### Audio Call
```
Caller                  Call Service                    Host
  │                         │                            │
  │── initiate_call ──────▶│                             │
  │                        │── incoming_call ──────────▶│
  │                        │◀── accept_call ───────────│
  │◀── call_accepted ─────│── call_accepted ──────────▶│
  │  (agoraToken)          │  (agoraToken)               │
  │                        │                             │
  │══ Agora Audio Channel ══════════════════════════════│
  │                        │                             │
  │                    [billing tick every 60s]           │
  │◀── billing_update ───│── billing_update ──────────▶│
  │                        │                            │
  │── end_call ──────────▶│                             │
  │◀── call_ended ────────│── call_ended ─────────────▶│
```

### Video Call
Same flow as audio but `callType: 'VIDEO'` — Agora publishes camera + mic tracks.

### Audio → Video Upgrade
```
Caller                  Call Service               Host
  │── request_upgrade ───▶│                          │
  │                       │── upgrade_requested ───▶│
  │                       │◀── accept_upgrade ─────│
  │◀── upgrade_accepted ──│                         │
  │  [publish video track] │  [publish video track]  │
```

### Reconnection (10-second window)
If a peer disconnects, the session transitions to `RECONNECTING` state. If the peer reconnects within 10 seconds, the call resumes. Otherwise, the call ends automatically.

---

## Billing Model

| Action | Cost | Host Earnings | Platform Cut |
|--------|------|---------------|--------------|
| Audio call | `audioRate` credits/min | 70% of cost | 30% |
| Video call | `videoRate` credits/min | 70% of cost | 30% |
| Message | `messageRate` credits/msg | 70% of cost | 30% |

- Callers pre-purchase credits into their wallet
- Per-minute billing ticks deduct from the caller's wallet
- Low-balance warnings at < 2 minutes remaining
- Auto-disconnect when balance reaches 0
- Host earnings tracked separately; platform cut logged in `platform_ledger`

---

## Getting Started

### Prerequisites
- Docker & Docker Compose
- Flutter SDK 3.11+ (for web development)
- Node.js 18+ (if developing services without Docker)

### Run with Docker Compose

```bash
# Clone the repository
git clone https://github.com/Smridul3004/o8m-Assignment.git
cd o8m-Assignment/Project

# Start all services
docker-compose up --build

# Services will be available at:
# API Gateway:  http://localhost:3000
# Flutter web:  Serve separately (see below)
```

### Run Flutter Web Client

```bash
cd client
flutter pub get
flutter run -d chrome --web-port=8080
```

> **Note:** The client uses `dart:js_interop` for Agora WebRTC and is **web-only**.

### Environment Variables

Create a `.env` file in the project root (optional — defaults are provided):

```env
POSTGRES_USER=o8m_user
POSTGRES_PASSWORD=change_me
POSTGRES_DB=o8m_db
JWT_SECRET=your_jwt_secret
AGORA_APP_ID=8140f62fea4f4f2b9bebaecd2b07ebb4
AGORA_APP_CERTIFICATE=7e70d82434d146f58227dc5e3f473238
PLATFORM_CUT_PERCENT=30
```

---

## Key Features

### Phase 1 — Core
- [x] User registration & JWT auth (caller/host roles)
- [x] Host profile management (bio, expertise, separate rates)
- [x] Host discovery with search & filtering
- [x] Real-time audio calling with Agora
- [x] Real-time video calling with Agora
- [x] Audio → video upgrade during call
- [x] Per-minute billing with wallet system
- [x] Real-time chat with paid messages
- [x] Call reconnection (10-second window)
- [x] Host availability status (ONLINE/BUSY/OFFLINE/IN_CALL)
- [x] Host earnings tracking & platform ledger
- [x] Notification service with Kafka + FCM

### Phase 2 — Advanced (Planned)
- [ ] Ratings & reviews post-call
- [ ] Host scheduling / calendar availability
- [ ] Call recording with consent
- [ ] Admin dashboard for platform management
- [ ] Screenshot blocking (DRM)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Flutter 3.11 (Web), Provider, Google Fonts |
| Real-time | Agora Web SDK 4.23, Socket.io |
| Backend | Node.js 18, Express 4 |
| Databases | PostgreSQL 16, MongoDB 7, Redis 7 |
| Messaging | Apache Kafka (Confluent 7.5) |
| Push | Firebase Cloud Messaging (optional) |
| Container | Docker Compose |

---

## Project Structure

```
Project/
├── docker-compose.yml
├── backend/
│   ├── api-gateway/         # HTTP proxy + auth middleware
│   ├── auth-service/        # Registration, login, JWT
│   ├── user-service/        # Profiles, rates, availability
│   ├── discovery-service/   # Host browsing, search
│   ├── chat-service/        # Conversations, messages, Socket.io
│   ├── call-service/        # Call signaling, Agora tokens, Redis sessions
│   ├── billing-service/     # Wallets, transactions, earnings
│   └── notification-service/# Push tokens, Kafka consumer, FCM
├── client/
│   ├── lib/
│   │   ├── core/            # Theme, providers, constants, services
│   │   └── features/        # Auth, profile, discovery, call, chat, home
│   └── web/
│       ├── agora_audio.js   # JS bridge for Agora audio
│       ├── agora_video.js   # JS bridge for Agora video
│       └── index.html       # Agora SDK CDN + JS bridges
```

---

## Scalability Considerations

- **Microservice architecture** allows independent scaling of hot services (Call, Chat)
- **Redis-backed sessions** enable horizontal scaling of the call service
- **Kafka event bus** decouples services for async processing
- **MongoDB sharding** for chat messages at scale
- **Agora cloud infrastructure** handles all media relay/routing
- **Stateless JWT auth** — no session server needed
- **Docker Compose** → production can migrate to Kubernetes

---

## License

This project is submitted as part of the o8m Labs Flutter Intern assignment.
