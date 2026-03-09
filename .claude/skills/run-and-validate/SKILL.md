---
name: "run-and-validate"
description: "Start all project services and validate them via browser. Trigger on: 'start the app', 'run everything', 'spin up services', 'validate the UI', 'end-to-end test', 'check if everything is running', 'launch the project', 'bring up the stack', 'is the app working?', 'smoke test'. ALWAYS use this skill when the user wants to start, run, validate, test, or check the running state of this application."
---

# Run & Validate Skill

Idempotently start all services for the schema-driven document extraction service and validate them — including visual QA via browser automation.

## Architecture Quick Reference

| Component | Port | Command | Health Check |
|-----------|------|---------|--------------|
| PostgreSQL | 5432 | `docker compose up -d` | `pg_isready -h localhost` |
| Redis | 6379 | `docker compose up -d` | `docker compose exec redis redis-cli ping` |
| Backend API | 3001 | `pnpm dev` | `curl -s http://localhost:3001/health` |
| Worker | — | `pnpm worker` | `pgrep -f worker-runner` |
| Frontend | 5173 | `cd frontend && pnpm dev` | `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173` |

**Proxy path**: Frontend at `:5173` proxies `/api/*` and `/health` to `:3001` (see `frontend/vite.config.ts`).

## Execution Phases

Run each phase in order. Every phase follows the **check-before-start** pattern: check if already running, only start if not, then verify.

---

### Phase 1: Docker (PostgreSQL + Redis)

**Check:**
```bash
docker compose ps --status running
```

**Start** (only if containers not running):
```bash
docker compose up -d
```

**Verify** (retry up to 5 times with 2s sleep):
```bash
pg_isready -h localhost -p 5432
docker compose exec redis redis-cli ping
```

If `pg_isready` is not available locally, use:
```bash
docker compose exec postgres pg_isready
```

---

### Phase 2: Backend API

**Check:**
```bash
lsof -i :3001 -sTCP:LISTEN
```

**Start** (only if port 3001 is not in use):
Run using Bash tool with `run_in_background: true`:
```bash
cd /Users/rosbel/Development/gently-ai/schema-driven-document-extraction-service && pnpm dev
```

**Verify** (wait up to 15s):
```bash
curl -sf http://localhost:3001/health
```
Expected response: `{"status":"ok","timestamp":"..."}`

---

### Phase 3: Worker

**Check:**
```bash
pgrep -f worker-runner
```

**Start** (only if not found):
Run using Bash tool with `run_in_background: true`:
```bash
cd /Users/rosbel/Development/gently-ai/schema-driven-document-extraction-service && pnpm worker
```

**Verify:**
```bash
pgrep -f worker-runner
```

---

### Phase 4: Frontend

**Check:**
```bash
lsof -i :5173 -sTCP:LISTEN
```

**Start** (only if port 5173 is not in use):
Run using Bash tool with `run_in_background: true`:
```bash
cd /Users/rosbel/Development/gently-ai/schema-driven-document-extraction-service/frontend && pnpm dev
```

**Verify** (wait up to 15s):
```bash
curl -sf -o /dev/null -w '%{http_code}' http://localhost:5173
```
Expected: `200`

---

### Phase 5: Cross-Service Health Check

Validate everything works together, including the Vite proxy path:

```bash
# Direct backend
curl -sf http://localhost:3001/health

# Frontend serves HTML
curl -sf http://localhost:5173 | head -5

# Proxy path (Vite → Express) — common failure point
curl -sf http://localhost:5173/api/schemas
```

The proxy check (`/api/schemas` via `:5173`) is critical — it confirms the Vite dev server correctly proxies API requests to the Express backend. If this fails but direct backend works, the issue is in `frontend/vite.config.ts` proxy config.

**Report status as a summary table** before proceeding to Visual QA.

---

### Phase 6: Visual QA (Browser Automation)

Use `npx agent-browser` for all browser commands. Never use the bare binary.

**Open browser:**
```bash
npx agent-browser open http://localhost:5173
```

**Take initial screenshot:**
```bash
npx agent-browser screenshot /tmp/docextract-home.png
```

**Navigate all pages** using snapshot-driven interaction:
1. Take a snapshot: `npx agent-browser snapshot`
2. Find the nav button ref from the snapshot output (refs are dynamic — never hardcode them)
3. Click using the ref: `npx agent-browser click <ref>`
4. Screenshot each page:
   - Documents page: `npx agent-browser screenshot /tmp/docextract-documents.png`
   - Schemas page: `npx agent-browser screenshot /tmp/docextract-schemas.png`
   - Recommend page: `npx agent-browser screenshot /tmp/docextract-recommend.png`

**Nav buttons in the UI** (from `frontend/src/App.tsx`):
- "Documents" — navigates to documents list
- "Schemas" — navigates to schemas list
- "Recommend" — navigates to schema recommendations

Report what each page shows (empty state, data, errors).

---

### Phase 7: E2E Smoke Test (Optional)

Only run if schemas exist in the system. Check first:
```bash
curl -sf http://localhost:3001/api/schemas
```

If schemas exist, upload a test document:
```bash
curl -sf -X POST http://localhost:3001/api/documents \
  -F "file=@<path-to-test-file>" \
  -F "schemaId=<first-schema-id>"
```

Then poll for completion:
```bash
# Get the document ID from the upload response
curl -sf http://localhost:3001/api/documents/<doc-id>
```

Poll every 3s until `status` is `completed` or `failed` (timeout after 60s).

---

### Phase 8: Cleanup

When done with validation:
```bash
npx agent-browser close
```

Do NOT kill backend/worker/frontend services — leave them running for the user.

Only kill services if the user explicitly asks to shut everything down:
```bash
# Kill by port
lsof -ti :3001 | xargs kill -9
lsof -ti :5173 | xargs kill -9
pkill -f worker-runner
docker compose down
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `pg_isready` fails | Docker not started | `docker compose up -d` and wait 5s |
| Port 3001 in use but `/health` fails | Stale process | `lsof -ti :3001 \| xargs kill -9` then restart |
| Port 5173 in use but returns error | Stale Vite process | `lsof -ti :5173 \| xargs kill -9` then restart |
| `/api/schemas` via `:5173` returns 404/502 | Proxy misconfiguration or backend not ready | Check backend is healthy first, then check `frontend/vite.config.ts` |
| Worker not processing jobs | Redis connection issue | Verify Redis is running: `docker compose exec redis redis-cli ping` |
| `npx agent-browser` not found | Not installed | `npm install -g agent-browser` or use `npx` (which auto-downloads) |
| Browser opens but page is blank | Frontend not built/serving | Check `lsof -i :5173` and Vite console output |
| Screenshots show error overlay | Runtime error in React | Read the error text from screenshot, check browser console via `npx agent-browser execute "console.log(document.title)"` |
| `EADDRINUSE` on startup | Port already bound | Kill the occupying process with `lsof -ti :<port> \| xargs kill -9` |

## Key Files

| File | Purpose |
|------|---------|
| `src/server.ts` | Express server with `/health` endpoint (line 19) |
| `src/queue/worker-runner.ts` | BullMQ worker process |
| `frontend/src/App.tsx` | SPA with nav: Documents, Schemas, Recommend |
| `frontend/vite.config.ts` | Vite dev server + proxy config (`/api` → `:3001`) |
| `docker-compose.yml` | PostgreSQL 16 + Redis 7 containers |
| `package.json` | `pnpm dev` (backend), `pnpm worker` (worker) scripts |
