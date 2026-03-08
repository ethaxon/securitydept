# AGENTS.md

_Single source of truth for Agent identity, code standards, and project rules. Referenced by `.cursorrules`, `CLAUDE.md`, and `GEMINI.md`._

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
- **YAML**: 2-space indent, quote only when necessary.
- **Bash**: `set -e`, `[[ ]]` not `[ ]`, quote variables.

## Project Rules

### File Organization

- **Docs**: [`README.md`](README.md) -> [`docs/`](docs/)
- **Data**: [`data/`](data/)
- **Temp**: [`temp/`](temp/) if agents need to create temp files, please use temp folder

### Multi-language Docs

Current languages and suffixes:
- English => no suffix
- Chinese => `_zh` suffix

- **Pattern**: English docs are the source of truth; create `*_{suffix}.md` for other languages versions
- **Coverage**: Translate user-facing docs (README, docs/00x-*.md); do NOT translate machine-oriented docs (AGENTS.md, CLAUDE.md, etc.)
- **Link localization**:
  - Add bidirectional links at the bottom of each doc: `[English](xxx.md) | [中文](xxx_zh.md) | ...`.
  - Other languages except English must link to same language docs when available.
- **Extensibility**: This pattern applies to any future language versions (e.g., `*_es.md`, `*_ja.md`)

### Tools Preferences

- **tools management**: use `mise` to manage tools such as `node`, `pnpm`, `rust`, etc.
- **actions**: use `justfile` to manage actions such as `build`, `test`, `lint`, `format`, etc, `justfile` will automatically load the `.env` file.
- **node package manager**: use `pnpm` as the package manager.
- **rust toolchain**: use `rust-toolchain.toml` to manage the rust toolchain, use `cargo` as the build tool.
- **typescript**: use tsconfig.json with references for managing the typescript project.
- **webui stack**: use typescript + vite + react + @tanstack/react-xxx seriers + tailwindcss + shadcn/ui for the webui stack.
- **server stack**: use rust + axum + openconnectid + serde + snafu + tracing series for the server stack.
