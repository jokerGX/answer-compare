# AnswerCompare

Multi-user website to upload screenshots, extract questions and answers via OpenAI, group similar questions (>=97% embedding cosine similarity), and visualize answer conflicts.

## Setup

1. Node.js 18+
2. Install deps:
   ```bash
   npm install
   ```
3. Create `.env`:
   ```bash
   cp .env.example .env
   # fill OPENAI_API_KEY
   ```
4. Run dev server:
   ```bash
   npm run dev
   ```

Open http://localhost:3000

## How it works

- Name-based login creates a profile in SQLite.
- Upload PNG/JPG screenshots; OpenAI extracts items: questionText, options (if present), chosenAnswers.
- We embed normalized question text and group by cosine similarity >= 0.97; otherwise create a new group.
- We store per-user variants and chosen answer; UI shows canonical question, options, and who chose what.
- If users disagree on answers, card is marked as conflict.

## API

- POST `/api/login` { name }
- GET  `/api/me`
- POST `/api/upload` multipart form field `screenshots` (multi)
- GET  `/api/groups`

Data persisted in `data/app.db`.

## Deploy

Option A: Single VPS/Render/Fly (backend + static)
- Run `npm run start` on a Node host. Set env: `OPENAI_API_KEY`, `SESSION_SECRET`, `NODE_ENV=production`.

Option B: Netlify (frontend) + Render/Vercel/Fly (backend)
1) Deploy this repo’s `public/` to Netlify as a static site.
2) Deploy `src/` server to a Node host (Render service recommended):
   - Env: `OPENAI_API_KEY`, `SESSION_SECRET`, `NODE_ENV=production`, `FRONTEND_ORIGIN=https://YOUR_NETLIFY_DOMAIN`, `COOKIE_SAMESITE=None`.
   - Ensure TLS so cookies can be `Secure`.
3) In Netlify, add a file `public/config.js` override via Netlify UI (or commit) with:
   ```js
   window.API_BASE = 'https://YOUR_BACKEND_DOMAIN';
   ```
4) Test: open Netlify URL → login → upload.



