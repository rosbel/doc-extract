# Schema-Driven Document Extraction Service

A service that ingests documents and turns them into structured, queryable knowledge using LLM-powered extraction with user-definable schemas.

## Architecture

```
┌──────────┐     ┌───────────────┐     ┌─────────────┐     ┌──────────┐
│  React   │────▶│  Express API  │────▶│  BullMQ     │────▶│  Claude  │
│  Frontend│◀────│  (REST)       │     │  (Redis)    │     │  (LLM)   │
└──────────┘     └───────┬───────┘     └──────┬──────┘     └──────────┘
                         │                     │
                    ┌────▼─────────────────────▼────┐
                    │        PostgreSQL              │
                    │  schemas · documents · jobs    │
                    └───────────────────────────────┘
```

**Flow**: Upload → SHA-256 dedup → extract text → classify against schemas (LLM) → extract structured data per schema (LLM) → store results → build search corpus → optionally index chunked embeddings in Pinecone.

## Prerequisites

- Node.js 20+
- pnpm
- Docker & Docker Compose
- OpenRouter API key (for LLM access)
- Pinecone API key (optional, for Smart Search semantic retrieval)

## Quick Start

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your OpenRouter API key and an ADMIN_TOKEN for the admin console

# 4. Push database schema
pnpm db:push

# 5. Start API server (port 3001)
pnpm dev

# 6. Start job worker (separate terminal)
pnpm worker

# 7. Start frontend (separate terminal)
cd frontend && pnpm install && pnpm dev
# UI available at http://localhost:5173

# Or run server + worker + frontend together from the repo root
pnpm dev:all
```

## Usage

1. **Create a schema** — Define it manually or use AI assist from prompts and sample documents
2. **Refine a schema** — AI edit assist can work from prompt-only guidance, uploaded samples, or stored documents; partial model responses are merged onto the current schema instead of failing outright
3. **Upload one or more documents** — PDF, DOCX, TXT, CSV, JSON, or Markdown
4. **Watch processing** — Status transitions: pending → classifying → extracting → completed (or `unclassified` / `failed` when processing cannot produce a matching extracted result)
5. **View results** — Extracted structured data with confidence scores
6. **Search** — Smart Search blends semantic retrieval with exact-match signals, with exact-text fallback when vectors are unavailable
7. **Admin console** — Visit `http://localhost:5173/admin`, enter `ADMIN_TOKEN`, and inspect queue/storage/provider health or run guarded maintenance actions

## API Reference

### Schemas
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/schemas` | Create extraction schema |
| POST | `/api/schemas/assist` | Generate or refine schema drafts with AI |
| GET | `/api/schemas` | List active schemas |
| GET | `/api/schemas/:id` | Get schema detail |
| GET | `/api/schemas/:id/revisions` | List saved schema revisions |
| POST | `/api/schemas/:id/revisions/:revisionId/restore` | Restore a saved revision as the new current version |
| PUT | `/api/schemas/:id` | Update schema |
| DELETE | `/api/schemas/:id` | Archive schema |

### Documents
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/documents` | Upload a single document (multipart `file`) |
| POST | `/api/documents/batch` | Upload multiple documents (multipart `files`) |
| GET | `/api/documents` | List with filtering/pagination |
| GET | `/api/documents/:id` | Detail with schema + jobs |
| GET | `/api/documents/:id/status` | Lightweight status poll |
| POST | `/api/documents/:id/reprocess` | Re-trigger pipeline |

### Search
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/search` | Search extracted data with hybrid smart search or exact-text mode |

### Admin
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/overview` | System health and operational summary |
| GET | `/api/admin/documents` | Admin document inventory with filters |
| DELETE | `/api/admin/documents/:id` | Hard-delete one document after confirmation |
| POST | `/api/admin/queue/pause` | Pause BullMQ processing |
| POST | `/api/admin/queue/resume` | Resume BullMQ processing |
| POST | `/api/admin/queue/clear` | Clear completed, failed, or waiting/delayed queue state |
| POST | `/api/admin/pinecone/clear` | Clear Pinecone vectors in the app namespace |
| POST | `/api/admin/reset` | Reset documents, schemas, uploads, queue state, and vectors |

## Design Decisions

1. **Content hashing (SHA-256)** — Prevents duplicate processing. Upload returns 409 with existing document ID.
2. **Two-phase pipeline (classify → extract)** — Allows independent retry and re-classification when schemas change. Extraction is pinned to the saved schema revision chosen at processing time, not a mutable live schema row.
3. **JSON Schema passthrough** — User-defined schemas flow directly to OpenRouter's `response_format`. No Zod conversion needed.
4. **AI schema edit fallback** — Edit assist accepts partial or alias-shaped model responses, merges omitted fields from the current schema, and treats zero-diff reviews as success instead of surfacing avoidable failures.
5. **JSONB for extracted data** — Supports querying on dynamic structures without schema migrations.
6. **BullMQ** — Production-grade job queue with retries, rate limiting, and stalled job recovery.
7. **Processing jobs as audit trail** — Full history of every LLM call with timing and error details.

Document read endpoints under `/api/documents` are exempt from HTTP rate limiting so list/detail/polling traffic does not interfere with upload workflows. Upload mutations remain rate-limited separately.

## Technology Choices And Comfort Level

- **TypeScript / Node.js / Express / PostgreSQL**: High comfort. This is the core stack used for the API, queue orchestration, and persistence.
- **BullMQ / Redis**: High comfort. Chosen to keep ingestion asynchronous and resilient under retries and reprocessing.
- **React / Vite**: High comfort. Used for a minimal frontend to exercise schema creation, uploads, and result inspection.
- **Pinecone**: Moderate comfort. Included as an optional semantic search backend; the service still works without it.
- **Search indexing**: Moderate comfort. Hybrid ranking uses PostgreSQL full-text plus optional Pinecone vectors for better recall without making vector infrastructure mandatory.
- **OpenRouter / LLM structured output**: High comfort. Used because schema-driven extraction is the central product requirement.

## Deliberate Simplifications

- **Authentication and authorization** are intentionally omitted because the prompt explicitly allowed that tradeoff.
- **Admin access uses a shared secret** (`ADMIN_TOKEN`) instead of user accounts or roles. This is intended for internal environments only.
- **Admin brute-force protection is in-memory**: repeated invalid admin token attempts are rate-limited and temporarily locked out per API process. This is acceptable for the MVP, but it is not shared across replicas or restarts; Redis-backed tracking would be the next step for multi-instance deployments.
- **File storage uses the local filesystem** instead of S3/GCS. The storage path is persisted so this can be swapped behind the same document model later.
- **Extraction text is truncated before LLM calls** to keep token usage bounded. For larger production deployments, this should evolve into chunking + schema-aware aggregation rather than a fixed cutoff.
- **Smart Search degrades gracefully** to exact-text search when Pinecone is not configured or unavailable, and the UI explains that fallback without exposing backend implementation details.

## Search Behavior

- **Default mode is Smart Search**: `POST /api/search` defaults to `hybrid`, which combines Pinecone semantic retrieval with PostgreSQL full-text and exact-match boosts.
- **Exact text remains available**: clients can explicitly send `mode: "keyword"` for literal matching behavior.
- **Unified result shape**: search returns one result list with `score`, `snippet`, `matchReasons`, `matchedFields`, `degraded`, and optional `degradedReason`.
- **Search corpus is denormalized**: documents persist a `search_text` value built from filename, schema context, flattened extracted fields, and raw text for reliable fallback and boosting.
- **Vector indexing is chunked**: Pinecone stores one structured header chunk plus overlapping raw-text chunks per document instead of a single JSON summary embedding.

## Schema Updates

The search upgrade adds a `documents.search_text` column and GIN index. After pulling these changes, run:

```bash
pnpm db:push
```

Schema changes are versioned forward. Every schema save creates a new revision, and documents processed before that save keep their existing `extractedData`, `schemaVersion`, and `schemaRevisionId` until they are explicitly reprocessed.

AI-assisted schema edits are also revision-oriented. The edit flow accepts full drafts, partial drafts, or top-level proposal objects from the model, normalizes alias fields, and merges missing values from the current schema before computing the diff shown in the UI. When the merged proposal produces no effective changes, the API returns a successful no-op review instead of a server error.

Reprocessing resets a document's schema assignment and extracted output, then runs classification and extraction again against the latest eligible schema revision at that time.

Existing documents will pick up the richer search corpus and vector chunks after reprocessing or an explicit backfill. After a schema change, older documents and newly reprocessed documents may temporarily have different extracted shapes until the older set is reprocessed.

## Testing

```bash
pnpm test        # Run all tests
pnpm test:watch  # Watch mode
```

## Tech Stack

- **Backend**: TypeScript, Express, Drizzle ORM, PostgreSQL
- **Queue**: BullMQ + Redis
- **LLM**: OpenRouter (Claude Sonnet via OpenAI-compatible API)
- **Frontend**: React 19, Vite, TailwindCSS
- **Vector Search**: Pinecone (optional)
- **Search Strategy**: Hybrid semantic + exact-match ranking with graceful fallback
- **Infrastructure**: Docker Compose
