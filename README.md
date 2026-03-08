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
```

## Usage

1. **Create a schema** — Define what data to extract (e.g., "Invoice" with fields: vendor, amount, date, line_items)
2. **Upload a document** — PDF, DOCX, TXT, CSV, JSON, or Markdown
3. **Watch processing** — Status transitions: pending → classifying → extracting → completed
4. **View results** — Extracted structured data with confidence scores
5. **Search** — Full-text keyword search or semantic search (with Pinecone)

## API Reference

### Schemas
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/schemas` | Create extraction schema |
| GET | `/api/schemas` | List active schemas |
| GET | `/api/schemas/:id` | Get schema detail |
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
