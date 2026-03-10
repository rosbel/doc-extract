# AGENTS.md — AI Agent Guidelines

## Before Committing Code
1. **Run `pnpm lint:fix`** to auto-fix formatting and lint issues.
2. **Run `pnpm lint`** to verify zero errors remain.
3. **Run `pnpm test`** to verify all tests pass.

## Before Pushing
1. **Run `pnpm build`** to verify TypeScript compilation succeeds.

## Important Notes
- This project uses **Biome** for linting and formatting — not ESLint or Prettier.
- Biome config is in `biome.json`. Indent style is tabs.
- See `CLAUDE.md` for full project conventions and available scripts.
