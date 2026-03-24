# AGENTS.md

_Single source of truth for Agent identity, code standards, and project rules. Symbolinked by `CLAUDE.md`, and `GEMINI.md`, only edit `AGENTS.md` when needed._

## Identity & Communication

- **Role**: An expert coding assistant.
- **Language**:
  - **Chat**: User's language (Use Chinese if user uses Chinese).
  - **Code/Comments**: English ONLY.
  - **Docs**: See Multi-language Docs Section.
- **Style**: Concise, technical, action-oriented.

## Code Standards

- **General**:
  - Comments explain _why_, not _what_. Update docs when logic changes.
  - If you community has a mature and modern library for a specific feature, use it instead of implementing it yourself.
  - Do NOT automatically create git commits. Leave staging and committing to the user or explicitly ask for permission first.
- **YAML**: 2-space indent, quote only when necessary.
- **Bash**: `set -e`, `[[ ]]` not `[ ]`, quote variables.
- **Docs**：docs should reflect current project status or futures plans, historical changes should be placed at CHANGELOG.md not in `docs` folder.

## Project Rules

### File Organization

- **Docs**: [`README.md`](README.md) -> [`docs/`](docs/)
- **Data**: [`data/`](data/)
- **Temp**: [`temp/`](temp/) if agents need to create temp files, please use temp folder

### Tools Preferences & Workflows

- **Toolchains**: `mise` (env), `pnpm` (Node config), `rust-toolchain.toml` / `cargo` (Rust).
- **Task Runner**: Use `just` for actions (`build`, `test`, `lint`, `format`); `.env` is auto-loaded.
- **Iteration Close-Out**: After each complete iteration, run formatting first, then verify the codebase is still healthy. At minimum, do `lint-fix`/format, re-run `lint`, and confirm relevant `typecheck`, `build`, and `test` commands pass. This is required so style drift and broken imports are caught in the same iteration instead of leaking into the next one.
- **TypeScript**:
  - Manage via `tsconfig.json` references.
  - Use `bundler` resolution (prefer extensionless imports without `.js` suffixes if not necessary).
  - Use `@standard-schema` for validation; avoid binding to specific libs like `zod`.
  - For enum-like string domains, prefer the modern JS-compatible pattern `export const Foo = { ... } as const` together with `export type Foo = (typeof Foo)[keyof typeof Foo]`. This keeps runtime output simple, stays maximally compatible with JS consumers and string protocols, and still gives strong TS completions.
  - For public contracts, high-frequency discriminants, and repeated telemetry vocabulary with stable meaning, prefer extracting named constants instead of scattering repeated raw strings. Do this when it improves consistency and discoverability, not for one-off UI copy or ad-hoc local text.
- **Web UI Stack**: TS + Vite + React + `@tanstack/react-*` + TailwindCSS + shadcn/ui.
- **Server Stack**: Rust + axum + openconnectid + serde + snafu + tracing.

### Multi-language Docs

**Directory Structure:**
- English docs: `docs/{lang}/00x-TITLE.md` (e.g., `docs/en/00x-TITLE.md`)

**Rules:**
- Translate user-facing docs only (README, docs/00x-*.md); do NOT translate machine-oriented docs (AGENTS.md, CLAUDE.md, etc.)
- Each doc should have bidirectional language links at the bottom: `[English](../en/xxx.md) | [中文](xxx.md)` (in Chinese docs) or `[English](xxx.md) | [中文](../zh/xxx.md)` (in English docs)
- Non-English docs must link to other docs in the same language folder when available (e.g., `docs/zh/` links point to `docs/zh/`)
- For future languages, create `docs/{lang}/` folder and follow the same pattern (e.g., `docs/es/`, `docs/ja/`)

**Current languages:**
- English: `docs/en/00x-TITLE.md`
- Chinese: `docs/zh/00x-TITLE.md`
