# Voice Messages

A phone-call-style voice message recorder. Hand someone the phone, they tap
**Answer**, talk, tap **End call** — the recording is saved and can be
replayed anytime from the Messages tab.

MERN stack: React (Vite) frontend, Express + MongoDB backend. Audio files are
stored on the server's disk (`server/uploads/`), with metadata (label,
duration, timestamp) in MongoDB.

## Project structure

```
voice-message-app/
  server/     Express API + MongoDB models, saves audio to /uploads
  client/     React (Vite) frontend
```

## Setup

### 1. Backend

```
cd server
npm install
cp .env.example .env   # edit MONGO_URI if not using local MongoDB
npm run dev
```

Runs on http://localhost:5000. Needs a MongoDB instance running (local
install or a free Atlas cluster — put the connection string in `.env`).

### 2. Frontend

```
cd client
npm install
npm run dev
```

Runs on http://localhost:5173 and proxies `/api` and `/uploads` requests to
the backend, so no CORS setup is needed in dev.

Open http://localhost:5173 on the phone you'll be recording with (your
computer's local IP if testing on an actual phone, e.g.
`http://192.168.x.x:5173`) — the browser will ask for microphone permission
on first use.

## Deploying

- `npm run build` in `client/` produces a static build you can serve from
  Express, Vercel, Netlify, etc.
- The server needs persistent disk for `uploads/` (or swap the multer disk
  storage for S3/Cloud storage if deploying somewhere with an ephemeral
  filesystem, like Heroku or most serverless hosts).
- Use HTTPS in production — `getUserMedia` (microphone access) is blocked on
  plain HTTP except on localhost.

## API

| Method | Route                | Description                          |
|--------|-----------------------|---------------------------------------|
| GET    | `/api/messages`       | List all messages, newest first       |
| POST   | `/api/messages`       | Upload a recording (`audio`, `label`, `duration` as multipart form data) |
| DELETE | `/api/messages/:id`   | Delete a message and its audio file   |
# Call-Me-Maybe
