# MediGuard MCP Architecture

## Current Runtime Flow

1. `src/server.ts` initializes environment, logger, and MCP server.
2. `src/tools/registerTools.ts` registers tools with input and output schemas.
3. Tool handlers delegate business logic to service modules.
4. Services query RxNorm and OpenFDA for normalization and interaction evidence.
5. Interaction synthesis uses Groq as primary and Gemini as fallback.
6. Tool handlers return MCP `content` and `structuredContent`.

## Folder Structure

```text
src/
  clients/     # External API clients (RxNorm, OpenFDA, Groq, Gemini)
  config/      # Runtime configuration and env validation
  errors/      # Shared application error types
  logging/     # Structured logging with redaction
  services/    # Domain/business logic and data providers
  tools/       # MCP tool definitions and registration
  types/       # Domain interfaces and shared types
tests/
  unit/        # Fast tests for isolated logic
  integration/ # Multi-module or transport-level tests
  safety/      # Clinical safety and regression scenarios
```

## Scaling Guidelines

- Keep MCP concerns in `tools/`; keep clinical logic in `services/`.
- Add one service per external data source (RxNorm, OpenFDA, DailyMed, FHIR).
- Keep LLM provider strategy resilient: Groq primary, Gemini fallback, rule-based final fallback.
- Define domain contracts in `types/` before implementation.
- Ensure all tool outputs have output schemas to protect clients from contract drift.
- Log metadata only; avoid raw patient identifiers and sensitive tokens.
