# MediGuard MCP Architecture

## Current Runtime Flow

1. `src/server.ts` initializes environment, logger, and MCP server (stdio or HTTP transport).
2. `src/tools/registerTools.ts` registers all 9 tools with Zod input/output schemas.
3. Tool handlers delegate business logic to service modules.
4. Services query RxNorm, OpenFDA, DailyMed, and PubMed for normalization, interaction, contraindication, and evidence data.
5. SHARP context hydration resolves patient medications, allergies, and conditions from FHIR when provided.
6. LLM synthesis uses Groq as primary, Gemini as fallback, and deterministic rules as final degradation.
7. Decision trace instrumentation captures step-level timing and summaries across all clinical tool calls.
8. Tool handlers return MCP `content` and `structuredContent`.

## Folder Structure

```text
src/
  clients/     # External API clients (RxNorm, OpenFDA, DailyMed, PubMed, Groq, Gemini)
  config/      # Runtime configuration and env validation
  errors/      # Shared application error types
  logging/     # Structured logging with PHI redaction
  services/    # Domain/business logic and data providers
  sharp/       # SHARP context schema and FHIR hydration
  tools/       # MCP tool definitions and registration (9 tools)
  types/       # Domain interfaces and shared types
tests/
  unit/        # Fast tests for isolated logic (32 suites)
  integration/ # Multi-module and FHIR transport-level tests
  safety/      # HIPAA, performance, and clinical regression checks
  e2e/         # End-to-end MCP Inspector tests against real APIs
```

## Scaling Guidelines

- Keep MCP concerns in `tools/`; keep clinical logic in `services/`.
- Add one service per external data source (RxNorm, OpenFDA, DailyMed, FHIR).
- Keep LLM provider strategy resilient: Groq primary, Gemini fallback, rule-based final fallback.
- Define domain contracts in `types/` before implementation.
- Ensure all tool outputs have output schemas to protect clients from contract drift.
- Log metadata only; avoid raw patient identifiers and sensitive tokens.
