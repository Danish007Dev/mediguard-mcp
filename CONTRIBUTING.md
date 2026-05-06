# Contributing to MediGuard MCP

Thanks for contributing to MediGuard MCP. This project focuses on medication safety tooling, so code changes must preserve clinical safety expectations and structured outputs.

## Quick Links

- Development setup: [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md)
- Local testing: [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- API reference: [docs/API_REFERENCE.md](docs/API_REFERENCE.md)

## Prerequisites

- Node.js 18+
- npm 9+

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `GROQ_API_KEY` and `GEMINI_API_KEY` (required for LLM synthesis).

## Build and Run

```bash
npm run build
npm start
```

Default transport is stdio. To run HTTP transport locally:

```powershell
$env:MCP_TRANSPORT="http"
$env:PORT="3000"
npm run build
npm start
```

## MCP Inspector (Manual Testing)

```bash
npm run inspect:dev
```

This builds the server and launches MCP Inspector against `dist/server.js`. See [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md) and [docs/DEMO_TEST_PLAYBOOK.md](docs/DEMO_TEST_PLAYBOOK.md) for sample payloads.

## Tests

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:safety
npm run test:coverage
```

Feature validation shortcuts:

- `npm run validate:feature3` (what-if simulation coverage)
- `npm run validate:feature4` (decision trace tooling coverage)

## Linting and Formatting

```bash
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run type-check
```

## Codebase Conventions

- **Tools vs services:** keep MCP tool definitions in `src/tools` and clinical logic in `src/services`.
- **Schemas:** define input/output Zod schemas for every tool and keep outputs stable.
- **Clients:** external data access lives under `src/clients` (RxNorm, OpenFDA, DailyMed, FHIR, LLMs).
- **Tests:** add unit tests for logic and safety tests for clinical regressions.
- **Docs:** update [docs/API_REFERENCE.md](docs/API_REFERENCE.md) and [README.md](README.md) when tool contracts change.

## Adding or Updating a Tool

1. Implement a tool in `src/tools` with Zod input/output schemas.
2. Register it in `src/tools/registerTools.ts`.
3. Add tests under `tests/unit` and `tests/safety`.
4. Update [docs/API_REFERENCE.md](docs/API_REFERENCE.md) and [README.md](README.md).

## Safety and Data Handling

- Do not include PHI or real patient identifiers in logs, tests, or example payloads.
- Use synthetic or anonymized data for demos and tests.
- Keep structured logging metadata-only; avoid raw tokens or patient details.

## Pull Request Checklist

- Tests pass for the area you touched.
- Linting and formatting are clean.
- Tool schemas and outputs remain backward compatible (or documented if not).
- Docs updated for any API or behavior changes.
- No secrets, `.env`, or API keys committed.

## Reporting Issues

When filing an issue, include:

- Reproduction steps and expected behavior
- Node and npm versions
- Tool name and sample input (with PHI removed)
- Logs with sensitive data redacted
