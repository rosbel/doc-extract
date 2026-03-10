# CLAUDE.md — Project Conventions

## Overview
Schema-driven document extraction service built with Express, Drizzle ORM, BullMQ, and OpenAI. Uses Vitest for testing and Biome for linting/formatting.

## Key Commands
- `pnpm lint` — Run Biome linter/formatter check (`biome check .`)
- `pnpm lint:fix` — Auto-fix lint and formatting issues (`biome check --write .`)
- `pnpm build` — TypeScript compilation (`tsc`)
- `pnpm test` — Run tests (`vitest run`)
- `pnpm dev` — Start dev server with watch mode
- `pnpm worker` — Start queue worker with watch mode

## Lint & Formatting
- **Biome** is the linter and formatter (not ESLint/Prettier). Config is in `biome.json`.
- Indent style: tabs
- Always run `pnpm lint` before committing to catch formatting and lint errors.
- Use `pnpm lint:fix` to auto-fix issues.

## Database
- ORM: Drizzle with PostgreSQL
- `pnpm db:push` — Push schema changes
- `pnpm db:generate` — Generate migrations
- `pnpm db:migrate` — Run migrations

## Project Structure
- `src/` — Application source code
- `src/db/` — Database schema and migrations
- `src/services/` — Business logic services
- `src/validation/` — Zod validation schemas
- `tests/` — Test files
- `frontend/` — Extraction frontend (separate package)
