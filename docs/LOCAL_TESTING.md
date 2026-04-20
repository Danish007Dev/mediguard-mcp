# Local Testing with MCP Inspector

This project uses stdio transport for local MCP development.

## Prerequisites

1. Install dependencies: `npm install`
2. Build server: `npm run build`

## Start Inspector

Run:

```bash
npm run inspect:dev
```

This runs the built server through MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

## Validate the Sample Tool

Tool name:

- `check_drug_interactions`

Example input payload:

```json
{
  "medications": ["warfarin", "ibuprofen", "vitamin d"]
}
```

Expected result:

- `source` should be `rxnorm-openfda`.
- `normalizedMedications` should include RxCUI mappings.
- `analysisProvider` should be `groq`, `gemini`, or `rule-based`.
- `structuredContent` should include interactions, summary, and `analysisRecommendations`.

## Troubleshooting

- If Inspector cannot connect, rebuild with `npm run build` and retry.
- If the tool returns an error, verify at least two medication names are provided.
- Use `LOG_LEVEL=debug` in `.env` for verbose logs.
- Add `GROQ_API_KEY` to enable primary LLM synthesis.
- Add `GEMINI_API_KEY` to enable fallback synthesis when Groq is unavailable.
