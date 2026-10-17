# AGENTS.md

Agent personas for usability-testing insulin pumps against MAUDE failure modes. See [prd.md](prd.md).

## Layout

- `apps/driver`, `apps/agent-persona`, `apps/firmware`: Python (uv workspace)
- `apps/visualizer`: Tauri (TS + Rust); `apps/scanner`: TS
- `packages/contracts` (Python, source of truth) → `packages/contracts-ts` (generated; run `pnpm contracts:gen`, never hand-edit)
- `scripts`: MAUDE download script (`scripts/download_maude.py`) and exploration notebook (`scripts/maude.ipynb`)

## Commands

- Setup: `pnpm setup`
- Verify before finishing: `pnpm check` (lint + typecheck + test). Narrower: `pnpm lint:py`, `pnpm typecheck`, `uv run pytest <path>`
- Fix formatting: `pnpm format`
- Stack: `pnpm stack:up` / `stack:down`

## Working rules

- Read surrounding code first; match its style, naming, and idioms.
- Keep diffs minimal and scoped to the task. No speculative abstractions or unrelated refactors.
- Run the relevant checks after changes; report failures honestly.
- Never commit secrets; config goes in `.env` (template: `.env.example`).

## Comments and docs

- Be concise. Everything — code, comments, docs, commit messages — as short as it can be while staying clear.
- Comment only the non-obvious *why*. No comments restating code, no changelog-style notes, no docstrings on trivial functions.
- Don't create new docs/READMEs unless asked. Update existing docs only when behavior changes.

## Git

- Do not add Claude (or any AI) as a co-author. No `Co-Authored-By` trailers, no "Generated with" lines in commits or PRs.
- Short, imperative commit messages.

## Subagents

- Use smaller/faster models (Sonnet, Haiku) for subagent tasks that don't need Opus: searching, exploration, file summaries, mechanical edits, running checks. Reserve Opus for design and hard debugging.
- Parallelize independent subagent work.
