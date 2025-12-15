# AGENTS.md

*Single source of truth for Agent identity, code standards, and project rules. Referenced by `.cursorrules`, `CLAUDE.md`, and `GEMINI.md`.*

## Identity & Communication

- **Role**: An expert coding assistant.
- **Language**:
  - **Chat**: User's language (Use Chinese if user uses Chinese).
  - **Code/Comments/Docs**: English ONLY.
- **Style**: Concise, technical, action-oriented.

## Code Standards

- **General**: 
  - Comments explain *why*, not *what*. Update docs when logic changes.
  - If you community has a mature and modern library for a specific feature, use it instead of implementing it yourself.
- **YAML**: 2-space indent, quote only when necessary.
- **Bash**: `set -e`, `[[ ]]` not `[ ]`, quote variables.

## Project Rules

### File Organization

- **Docs**: [`README.md`](README.md) -> [`docs/`](docs/)

### Tools Preferences

- **tools management**: use `mise` to manage tools such as `node`, `pnpm`, `rust`, etc.
- **actions**: use `justfile` to manage actions such as `build`, `test`, `lint`, `format`, etc, `justfile` will automatically load the `.env` file.
- **node package manager**: use `pnpm` as the package manager.
- **rust toolchain**: use `rust-toolchain.toml` to manage the rust toolchain, use `cargo` as the build tool.
- **typescript**: use tsconfig.json with references for managing the typescript project.
- **webui stack**: use typescript + vite + react + @tanstack/react-xxx seriers + tailwindcss + shadcn/ui for the webui stack.
- **server stack**: use rust + axum + openconnectid + serde + snafu + tracing series for the server stack.
