# AGENTS.md

Claude-driven personas usability-test insulin pumps against MAUDE failure modes. Design: [docs/prd.md](docs/prd.md). Layout, setup, commands: [docs/development.md](docs/development.md).

## Rules

- `packages/contracts` (pydantic) owns every cross-process message. After changing it, run `pnpm contracts:gen`; never hand-edit `packages/contracts-ts`.
- One lockfile per ecosystem (`uv.lock`, `pnpm-lock.yaml`); shared tooling config lives at the root.
- Read surrounding code first and match its style. Keep diffs minimal and scoped; no speculative abstractions or unrelated refactors.
- Verify with `pnpm check` (narrower: `pnpm lint:py`, `pnpm typecheck`, `uv run pytest <path>`); fix formatting with `pnpm format`. Report failures honestly.
- Secrets go in `.env` (template: `.env.example`), never in git.

## Style

- Everything as short as it can be while staying clear: code, comments, docs, commits.
- Comment only the non-obvious *why*. No comments restating code, no changelog notes, no docstrings on trivial functions.
- Don't add docs unless asked; update existing docs when behavior changes.

## Git

- Short, imperative Conventional Commits.
- No AI co-author trailers or "Generated with" lines.

## Subagents

- Use smaller models (Sonnet, Haiku) for search, exploration, mechanical edits and checks; reserve Opus for design and hard debugging. Run independent work in parallel.
