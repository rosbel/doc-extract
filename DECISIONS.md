# Design Decisions

This document explains the key architectural and implementation decisions made in this project, evaluated against the core requirements.

---

## 1. Document Ingestion Pipeline

> Implement a document submission flow that would hold up in production. Consider: asynchronous processing vs synchronous, idempotency, retries, status tracking, re-processing, duplicate submissions, and handling large / messy inputs.

### Asynchronous Processing vs Synchronous

**Decision: Asynchronous, two-phase pipeline via BullMQ + Redis.**

The upload endpoint (`POST /api/documents`) returns `201 Created` immediately after storing the document and enqueuing a classification job. Processing happens in a separate worker process (`src/queue/worker-runner.ts`), completely decoupled from the HTTP server.

The pipeline has two distinct phases:

1. **Classification** (`classify` job): Sends document text + all active schemas to the LLM, which returns the best-matching schema ID with confidence and reasoning.
2. **Extraction** (`extract` job): Uses the matched schema's JSON Schema definition to extract structured data from the document via LLM.

This separation matters because:
- Each phase can fail and retry independently. A classification failure doesn't require re-extracting, and vice versa.
- When schemas change, documents can be re-classified without repeating file parsing.
- The worker process can be scaled independently from the API server.
- Rate limiting (10 jobs/60s) and concurrency control (2 concurrent jobs) prevent overwhelming the LLM API.

**Key files:**
- `src/queue/index.ts` — Queue configuration (attempts, backoff, retention)
- `src/queue/jobs.ts` — Job enqueueing with deduplication
- `src/queue/workers.ts` — Classification handler (lines 13-90), extraction handler (lines 92-177)
- `src/queue/worker-runner.ts` — Worker process entry point with graceful shutdown

### Idempotency

**Decision: Content-hash deduplication at upload + deterministic job IDs.**

Two layers prevent duplicate work:

1. **Upload-time deduplication**: A SHA-256 hash is computed from the raw file buffer before any processing (`src/lib/hashing.ts`). The `contentHash` column has a unique database index (`src/db/schema.ts:70`). If a duplicate is detected, the API returns `409 Conflict` with the existing document's ID, allowing the client to reference the already-processed result.

2. **Job-level deduplication**: Job IDs follow deterministic patterns — `classify-{documentId}` and `extract-{documentId}-{schemaId}` (`src/queue/jobs.ts`). Before enqueueing, stale completed/failed jobs with the same ID are cleaned up, preventing accidental re-queueing.

This means: uploading the same file twice (even with a different filename) will not create a second document or trigger duplicate processing.

### Retries

**Decision: 3 attempts with exponential backoff, automatic stalled job recovery.**

Configuration in `src/queue/index.ts:18-26`:
- `attempts: 3`
- `backoff: { type: "exponential", delay: 5000 }` — 5s, 10s, 20s
- BullMQ automatically recovers stalled jobs (worker crash mid-processing)

When all retries are exhausted, the worker's `failed` event handler (`src/queue/workers.ts:209-230`) marks the document status as `failed` and stores the error message. The user can then manually trigger re-processing.

### Status Tracking

**Decision: Document-level status enum + per-job audit trail.**

Document status progresses through: `pending → classifying → extracting → completed` (or `failed` at any stage). This is tracked on the `documents` table directly (`src/db/schema.ts:18-25`).

For detailed audit history, every LLM processing call creates a record in the `processingJobs` table (`src/db/schema.ts:73-86`) capturing:
- Job type (classification or extraction)
- Status with timestamps (`startedAt`, `completedAt`)
- Attempt number
- Error messages on failure
- Full LLM response metadata (JSONB)

The frontend polls a lightweight status endpoint (`GET /api/documents/:id/status` — `src/routes/documents.ts:130-149`) that returns only the status, confidence, and error fields — minimal data for efficient polling.

### Re-processing

**Decision: Atomic reset endpoint that clears results and re-enqueues.**

`POST /api/documents/:id/reprocess` (`src/routes/documents.ts:152-176`) performs an atomic update:
- Resets status to `pending`
- Clears `extractedData`, `extractionConfidence`, `errorMessage`, and `schemaId`
- Immediately enqueues a new classification job

This triggers a full re-run through both pipeline phases. It's useful when schemas have been updated, when the LLM produced poor results, or after fixing upstream issues.

### Duplicate Submissions

**Decision: SHA-256 content hashing with database-enforced uniqueness.**

See the Idempotency section above. The content hash is computed on the raw file buffer (`src/routes/documents.ts:31-32`), not on extracted text, ensuring byte-level deduplication regardless of parsing differences. A database unique index (`src/db/schema.ts:70`) provides the authoritative constraint, with a helper function (`src/lib/db-errors.ts:6-8`) to detect constraint violations for race condition handling.

### Handling Large / Messy Inputs

**Decision: Configurable limits, defensive parsing, and graceful degradation.**

Multiple layers handle problematic inputs:

- **File size limits**: Multer configured with `MAX_FILE_SIZE` env var (default 10MB) — `src/routes/documents.ts:16-19`
- **PDF timeout**: 10-second timeout wrapping pdf-parse to prevent hanging on malformed PDFs — `src/services/file-parser.ts:87-98`
- **Text quality assessment**: `parseFileSafe()` evaluates extracted text quality (`src/services/file-parser.ts:61-83`):
  - Detects empty files (0 or whitespace-only)
  - Flags very small files (<20 characters)
  - Warns on high non-printable character ratio (>30%)
- **LLM truncation**: Both classifier and extractor truncate input to 8,000 characters (`src/services/classifier.ts:7`, `src/services/extractor.ts:7`) to prevent token limit violations
- **Supported formats**: PDF, DOCX, TXT, CSV, Markdown, JSON — with fallback to plain UTF-8 for unknown types (`src/services/file-parser.ts:35-47`)

---

## 2. Classification & Extraction

> Decide how documents should be routed to the right "type" / schema (if applicable) and how structured outputs should be produced. The set of document types and extraction schemas should be definable by the user/system (not hard-coded).

### Document Routing / Classification

**Decision: LLM-based classification against all active user-defined schemas.**

When a document enters the classification phase, the classifier (`src/services/classifier.ts:15-102`):
1. Fetches all schemas with status `active` from the database
2. Sends the document text (first 8,000 chars) along with each schema's name, description, and classification hints to the LLM
3. The LLM returns the best-matching `schemaId`, a `confidence` score (0-1), and `reasoning`
4. The returned `schemaId` is validated against the active schema list to prevent hallucinated IDs

The classification uses OpenRouter's structured JSON output (`response_format`) with a defined schema for the response, ensuring type-safe results.

**Why LLM-based rather than rule-based?** Document types in the real world are varied and ambiguous. An LLM can understand semantic content (e.g., distinguishing an invoice from a purchase order even when they share similar fields) in ways that keyword matching cannot. The classification hints on each schema provide guidance without being rigid rules.

### Structured Output Production

**Decision: LLM extraction using the user's JSON Schema as the response format, with schema normalization.**

The extractor (`src/services/extractor.ts:43-137`) takes the user-defined JSON Schema and:

1. **Normalizes it** for strict LLM compliance (`src/services/extractor.ts:15-41`):
   - Adds `additionalProperties: false` to prevent extraneous fields
   - Sets all properties as `required` to ensure complete extraction
   - Recursively normalizes nested objects and array items
2. **Wraps it in an envelope**: The actual schema sent to the LLM includes both `extractedData` (the user schema) and `confidence` (a number 0-1), so the LLM self-reports its extraction certainty
3. **Passes it as `response_format`** to OpenRouter, leveraging the API's structured output mode for guaranteed JSON conformance

**Robustness measures:**
- `parseLLMResponse()` (`src/lib/parse-llm-response.ts`) handles JSON wrapped in prose text (finds first `{` to last `}`)
- The extractor handles snake_case variants from the LLM (`extracted_data` → `extractedData`)
- Falls back to treating the raw response as `extractedData` if the LLM ignores the envelope
- Validates that `extractedData` is an object and `confidence` is a number before storing

### User-Definable Schemas (Not Hard-Coded)

**Decision: Full CRUD API for schemas stored as JSONB in PostgreSQL.**

There are zero hard-coded document types anywhere in the codebase. The system is entirely driven by user-created schemas:

- **Schema model** (`src/db/schema.ts:36-49`): Each schema has a `name`, `description`, `version`, `jsonSchema` (JSONB), `classificationHints` (text array), and `status` (active/archived)
- **CRUD endpoints** (`src/routes/schemas.ts`):
  - `POST /api/schemas` — Create a new schema with JSON Schema definition
  - `GET /api/schemas` — List all active schemas
  - `GET /api/schemas/:id` — Get schema details
  - `PUT /api/schemas/:id` — Update schema (fields, hints, etc.)
  - `DELETE /api/schemas/:id` — Soft-delete (archives, preserving history)
- **AI-assisted schema creation** (`src/services/schema-recommender.ts`): Users can upload sample documents to `POST /api/recommendations`, and the LLM analyzes them to suggest appropriate schemas — complete with JSON Schema definitions, classification hints, and reasoning. These can be accepted directly via the frontend.

This means a user can define a new document type (e.g., "Medical Lab Report") by creating a schema with the relevant fields, and all subsequently uploaded documents will be classified and extracted against it — no code changes required.

---

## 3. Storage

> Decide what to store and how. Your decisions here are a core part of the challenge.

### What is Stored

| Data | Where | Why |
|------|-------|-----|
| **Original file** | Local filesystem (`./uploads/`) | Preserves source material for re-processing, audit, and potential re-parsing with improved parsers |
| **Raw extracted text** | `documents.rawText` (PostgreSQL text column) | Enables re-classification, re-extraction, and chunked semantic indexing without re-parsing files |
| **Denormalized search corpus** | `documents.searchText` (PostgreSQL text column) | Stable hybrid-search input built from filename, schema context, flattened extracted fields, and raw text |
| **Content hash** | `documents.contentHash` (unique-indexed text) | Byte-level deduplication at upload time |
| **File metadata** | `documents.filename`, `mimeType`, `fileSize`, `storagePath` | Context for display, debugging, and file retrieval |
| **Processing status** | `documents.status` (enum) | Current state in the pipeline for polling and filtering |
| **Matched schema reference** | `documents.schemaId` (FK to `extractionSchemas`) | Links document to its classified type |
| **Extracted structured data** | `documents.extractedData` (JSONB) | The actual extraction output — schema-agnostic, queryable |
| **Extraction confidence** | `documents.extractionConfidence` (float) | Quality signal for downstream consumers |
| **Error details** | `documents.errorMessage` (text) | Debugging and user feedback on failures |
| **Processing audit trail** | `processingJobs` table (JSONB metadata) | Complete history of every LLM call with timing, attempt numbers, errors, and full response metadata |
| **Schema definitions** | `extractionSchemas.jsonSchema` (JSONB) | User-defined extraction templates |
| **Vector embeddings** | Pinecone (optional) | Chunked semantic retrieval across structured and raw document content |

### How it is Stored

**Database: PostgreSQL with Drizzle ORM** (`src/db/schema.ts`)

Three tables with clear relationships:

1. **`extraction_schemas`** — Schema definitions (1-to-many with documents)
2. **`documents`** — Document records with extraction results (many-to-1 with schemas, 1-to-many with jobs)
3. **`processing_jobs`** — Audit trail (many-to-1 with documents, cascade delete)

**Key design choices:**

- **JSONB for `extractedData`**: Since each document type has a different schema, the extracted output varies per document. JSONB stores any valid JSON object and supports PostgreSQL's JSON query operators, allowing filtered queries (e.g., "find all invoices where `vendor_name` contains 'Acme'") without per-schema migrations. This is the central storage decision — it decouples the document types from the database schema.

- **Denormalized `searchText` on documents**: Search should not depend on reconstructing ad hoc text at query time from `rawText` plus JSON casting. Persisting a normalized corpus keeps PostgreSQL full-text behavior predictable, lets search ranking use the same text the vector layer sees, and creates a clean place to add a GIN index.

- **JSONB for `jsonSchema` on schemas**: Stores the full JSON Schema definition as a first-class database object. No file-system dependency for schema definitions.

- **JSONB for `metadata` on processing jobs**: Stores full LLM response data (model, tokens used, raw output) for debugging and analytics without a rigid column structure.

- **Cascade deletes**: When a document is deleted, all its processing jobs are automatically cleaned up (`src/db/schema.ts:78`). Schemas use soft-delete (archived status) to preserve referential integrity with existing documents.

- **Unique index on `contentHash`**: Database-enforced deduplication, not just application-level.

- **GIN index on `searchText` tsvector**: Keyword fallback and hybrid boosting need fast lookup on the denormalized search corpus rather than repeated full-table vectorization.

**File storage: Local filesystem**

Original uploaded files are stored at `./uploads/{uuid}-{filename}` via Multer. The `storagePath` is recorded in the database for retrieval. This is intentionally simple — in production, this would be swapped for S3/GCS with the same interface.

**Vector storage: Pinecone (optional)** (`src/services/vector-store.ts`)

After successful extraction, the service builds a structured header chunk plus overlapping raw-text chunks and upserts them to Pinecone. This is best-effort — Pinecone failures don't block document completion. The vector store is only active when `PINECONE_API_KEY` is configured, and search degrades to exact-text mode when vectors are unavailable.

---

## 4. APIs

> Design and implement a small set of APIs that make the system usable.

### API Design

The API surface is organized around three resources — schemas, documents, and search — plus a utility endpoint for AI recommendations.

#### Schema Management (`src/routes/schemas.ts`)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/schemas` | Create a new extraction schema (name, description, JSON Schema, classification hints) |
| `GET /api/schemas` | List all active schemas |
| `GET /api/schemas/:id` | Get a specific schema's full details |
| `PUT /api/schemas/:id` | Update any schema fields |
| `DELETE /api/schemas/:id` | Soft-delete (archive) a schema |

Schemas are the system's configuration layer. A user defines what document types exist and what fields to extract by creating schemas. Archiving (rather than hard-deleting) preserves history for already-extracted documents.

#### Document Lifecycle (`src/routes/documents.ts`)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/documents` | Upload a file (multipart). Returns immediately; processing is async. Returns 409 on duplicate. |
| `GET /api/documents` | List documents with pagination (`page`, `limit`), filtering (`status`, `schemaId`), sorted by newest first |
| `GET /api/documents/:id` | Full document detail including related schema and processing job history |
| `GET /api/documents/:id/status` | Lightweight status poll (id, status, confidence, error only) |
| `POST /api/documents/:id/reprocess` | Reset and re-run the full pipeline |

The separation between the full detail endpoint and the lightweight status endpoint is deliberate — the frontend polls `/status` every few seconds during processing, and it returns minimal data to keep that efficient.

#### Search (`src/routes/search.ts`)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/search` | Search documents with hybrid smart search or exact-text mode |

Search now defaults to `hybrid`, which combines Pinecone chunk retrieval with PostgreSQL full-text ranking and exact-match boosts. `keyword` remains available as an explicit exact-text mode. Both support optional `schemaId` filtering.

The hybrid path works as follows:

- A semantic query is expanded with selected schema context (schema name and field names) before embedding.
- Pinecone retrieves the top matching chunks, and chunk matches are collapsed back to document-level candidates.
- PostgreSQL scores the same query against `documents.searchText` using full-text ranking plus exact-match checks on filename and extracted values.
- Final scores blend semantic score, normalized keyword score, and small structured boosts for exact field matches, multi-chunk coverage, and high extraction confidence.
- The API returns one unified result list with `score`, `snippet`, `matchReasons`, `matchedFields`, `degraded`, and optional `degradedReason`.

This design keeps semantic retrieval as the primary behavior without making Pinecone a hard dependency. When vectors are unavailable, the response is still structurally identical and the frontend can present a user-friendly “exact text fallback” message instead of a backend-specific error.

#### AI Recommendations (`src/routes/recommendations.ts`)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/recommendations` | Upload sample files (up to 10), get AI-suggested extraction schemas |

This is a convenience feature that bootstraps schema creation. Users upload representative documents, the LLM analyzes them, and returns suggested schemas with JSON Schema definitions, classification hints, and reasoning. The frontend allows one-click creation of recommended schemas.

### Cross-Cutting Concerns

- **Input validation**: Zod schemas (`src/validation/schemas.ts`) validate all request bodies and query parameters. Invalid input returns 400 with detailed field-level errors.
- **Error handling**: Centralized error middleware (`src/middleware/error-handler.ts`) handles Zod errors (400), custom status codes, and unexpected errors (500 with logging).
- **Request logging**: Every request is logged with method, URL, status code, and duration (`src/middleware/request-logger.ts`).
- **CORS**: Enabled for frontend development.
- **Health check**: `GET /health` for infrastructure monitoring.

### What's Not Included (and Why)

- **Authentication/authorization**: Not in scope for this challenge. In production, this would be an auth middleware layer (JWT, API keys, etc.).
- **Admin access model**: The internal admin console uses a shared `ADMIN_TOKEN` header rather than full user accounts. This keeps the MVP operationally simple while still protecting destructive endpoints.
- **Admin brute-force protection**: Repeated invalid admin token attempts are tracked and temporarily locked out in process memory on the API server. This is an explicit MVP tradeoff: it protects a single instance from naive brute-force attempts, but it is not durable across restarts and is not coordinated across multiple replicas. A Redis-backed limiter would be the production evolution.
- **API versioning**: Single version is sufficient for the current scope.
- **Rate limiting at HTTP level**: Queue-level rate limiting (10 jobs/60s) protects the LLM API; HTTP rate limiting would be added via middleware (e.g., express-rate-limit) in production.
- **Webhook/callback notifications**: Polling-based status tracking is simpler and sufficient. Webhooks would be added for system-to-system integration.
