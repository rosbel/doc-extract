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

**Flow**: Upload → SHA-256 dedup → extract text → classify against schemas (LLM) → extract structured data per schema (LLM) → store results → optionally index in Pinecone.

## Prerequisites

- Node.js 20+
- pnpm
- Docker & Docker Compose
- OpenRouter API key (for LLM access)
- Pinecone API key (optional, for semantic search)

## Quick Start

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your OpenRouter API key

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
2. **Upload a document** — PDF, DOCX, TXT, CSV, JSON, or Markdown
3. **Watch processing** — Status transitions: pending → classifying → extracting → completed
4. **View results** — Extracted structured data with confidence scores
5. **Search** — Full-text keyword search or semantic search (with Pinecone)

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
| POST | `/api/documents` | Upload document (multipart) |
| GET | `/api/documents` | List with filtering/pagination |
| GET | `/api/documents/:id` | Detail with schema + jobs |
| GET | `/api/documents/:id/status` | Lightweight status poll |
| POST | `/api/documents/:id/reprocess` | Re-trigger pipeline |

### Search
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/search` | Search extracted data |

## Design Decisions

1. **Content hashing (SHA-256)** — Prevents duplicate processing. Upload returns 409 with existing document ID.
2. **Two-phase pipeline (classify → extract)** — Allows independent retry and re-classification when schemas change.
3. **JSON Schema passthrough** — User-defined schemas flow directly to OpenRouter's `response_format`. No Zod conversion needed.
4. **JSONB for extracted data** — Supports querying on dynamic structures without schema migrations.
5. **BullMQ** — Production-grade job queue with retries, rate limiting, and stalled job recovery.
6. **Processing jobs as audit trail** — Full history of every LLM call with timing and error details.

## Technology Choices And Comfort Level

- **TypeScript / Node.js / Express / PostgreSQL**: High comfort. This is the core stack used for the API, queue orchestration, and persistence.
- **BullMQ / Redis**: High comfort. Chosen to keep ingestion asynchronous and resilient under retries and reprocessing.
- **React / Vite**: High comfort. Used for a minimal frontend to exercise schema creation, uploads, and result inspection.
- **Pinecone**: Moderate comfort. Included as an optional semantic search backend; the service still works without it.
- **OpenRouter / LLM structured output**: High comfort. Used because schema-driven extraction is the central product requirement.

## Deliberate Simplifications

- **Authentication and authorization** are intentionally omitted because the prompt explicitly allowed that tradeoff.
- **File storage uses the local filesystem** instead of S3/GCS. The storage path is persisted so this can be swapped behind the same document model later.
- **Extraction text is truncated before LLM calls** to keep token usage bounded. For larger production deployments, this should evolve into chunking + schema-aware aggregation rather than a fixed cutoff.
- **Semantic search is optional** and only active when Pinecone is configured, so the core ingestion path does not depend on vector infrastructure.

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
- **Infrastructure**: Docker Compose
