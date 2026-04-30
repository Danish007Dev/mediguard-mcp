# MediGuard MCP - Development Guide

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

The default transport is stdio. To run in HTTP mode:

```bash
# PowerShell
$env:MCP_TRANSPORT="http"
$env:PORT="3000"
npm run build
npm start
```

## Local MCP Inspector

```bash
npm run inspect:dev
```

Example payload:

```json
{
  "medications": ["warfarin", "ibuprofen"]
}
```

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
npm run format
```

## Adding or Updating Tools

1. Implement a tool under `src/tools` with input/output Zod schemas.
2. Register it in `src/tools/registerTools.ts`.
3. Add unit and safety tests under `tests/unit` and `tests/safety`.
4. Update [docs/API_REFERENCE.md](API_REFERENCE.md) and [README.md](../README.md).
