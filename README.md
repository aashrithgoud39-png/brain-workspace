# Brain — role-based knowledge workspace

A full-stack internal search tool. Employees search only the documents their team is allowed to see; managers see everything, upload new sources, manage employee profiles, and schedule meetings. Includes 1:1 chat with presence.

**Stack:** Node.js · Express 5 · PostgreSQL (full-text search) · JWT session cookies · vanilla JS frontend served by the same Express app.

## What the backend does

- **Auth** – bcrypt-hashed passwords, JWT in an `httpOnly` cookie, role check on every request, login rate limiting (failed attempts only), user re-loaded from the DB per request so deleted accounts lose access immediately.
- **Permissioned search** – Postgres `tsvector` + GIN index. Visibility (`org` / `team` / `managers`) is enforced *inside the SQL query*, so restricted documents never reach the browser; employees only receive a count of hidden results.
- **Uploads** – PDF, DOCX, CSV, TXT, MD → text extracted server-side → indexed. 5 MB per file.
- **Chat, meetings, employee admin** – REST endpoints; meetings get a real Jitsi room link.
- **Hardening** – Helmet + CSP, parameterized queries only, output escaped on the client, input validation, 100 KB JSON limit.

## Run locally

```bash
# 1. a Postgres database (local, Docker, or a free Neon project)
cp .env.example .env        # then edit DATABASE_URL / JWT_SECRET
npm install
npm start                   # creates tables + loads demo data on first run → http://localhost:3000
npm test                    # in a second terminal, while the server is running (use a freshly seeded DB)
npm run seed                # wipe and reload the demo data
```

Demo logins (password `demo1234`): employee `AK-1042` (Support), manager `RI-2001`.

## Deploy (Neon + Render, both free tiers)

1. **Database** – create a project at neon.com, copy the connection string.
2. **Code** – push this folder to a GitHub repo.
3. **Server** – on render.com: *New → Blueprint* → pick the repo (uses `render.yaml`). When asked, paste the Neon string as `DATABASE_URL`.
4. Open the `*.onrender.com` URL. The first start creates the tables and demo data.

Free-tier notes: Render sleeps idle free services after 15 minutes (the next visit takes about a minute to wake). If Neon's string contains `&channel_binding=require` and the connection fails, delete that part.

## API

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | all | session |
| `GET /api/search?q=` | all | permission-scoped search |
| `GET /api/chat` · `GET/POST /api/chat/:userId` | all | contacts, history, send |
| `GET /api/meetings` | all | meetings I host / am invited to |
| `POST /api/meetings` · `DELETE /api/meetings/:id` | manager | schedule / cancel |
| `GET/POST /api/employees` · `PATCH …/:id/status` · `DELETE …/:id` | manager | manage profiles |
| `GET/POST /api/documents` · `DELETE …/:id` | manager | upload & manage sources |
