# Repository Guidelines

## Project Structure & Module Organization

The repository is a Node 20+ monorepo managed through npm workspaces. Core
functionality lives under `packages/`: `cli` provides the terminal UI, `core`
wraps shared services, `a2a-server` exposes the Agent-to-Agent bridge,
`vscode-ide-companion` syncs the VS Code extension, and `test-utils` holds
fixtures. Integration flows live in `integration-tests/`, CLI docs and assets in
`docs/`, and automation utilities in `scripts/`. Generated bundles end up in
`bundle/`; never edit them by hand.

## Build, Test, and Development Commands

Run `npm install` (or `make install`) after cloning. `npm run build` transpiles
all workspaces, and `npm run build:sandbox` produces the container payload used
by integration tests. Launch the CLI locally with `npm run start`;
`npm run debug` starts with `--inspect-brk` for attaching DevTools. Use
`npm run bundle` when you need to regenerate the distributable, and
`make build-all` as the shortcut for the full bundle + sandbox flow.

## Coding Style & Naming Conventions

All packages are TypeScript modules targeting ECMAScript modules. Formatting is
enforced by Prettier (`npm run format`) with 2-space indentation and single
quotes. ESLint (`npm run lint`) applies the shared config in `eslint.config.js`;
address lint errors before sending a PR. Favor camelCase for functions and
variables, PascalCase for React components (see `packages/cli/src/gemini.tsx`),
and kebab-case for filenames. Preserve the Apache 2.0 license header used at the
top of source files.

## Testing Guidelines

Unit specs sit next to implementation files as `*.test.ts` or `*.test.tsx`.
`npm run test` executes all workspace tests in parallel with Vitest. For
environment-sensitive coverage, run `npm run test:integration:sandbox:none`;
Docker and Podman flavors are available via
`npm run test:integration:sandbox:docker` and `...:podman`. Scripts under
`scripts/tests/` use the same harness; keep new suites deterministic and
compatible with `npm run test:ci`.

## Commit & Pull Request Guidelines

Follow the existing log pattern:
`type(scope) - concise imperative summary (#12345)` (see `git log`). Reference
the GitHub issue or PR number in parentheses when applicable. Each PR should
include a short summary, linked issue, testing notes (commands run), and updates
to docs or screenshots when behavior changes. Run `npm run lint`,
`npm run test`, and relevant integration suites before requesting review.

## Security & Configuration Tips

Consult `SECURITY.md` before filing vulnerabilities. Avoid committing API keys
or user data; scripts like `scripts/create_alias.sh` should be run locally, not
checked in. Use `npm run auth` when authenticating against internal registries,
and revoke temporary credentials after testing.
