### Phase 5: LLM Integration & Reasoning (Days 17-20)
**Goal**: Strengthen Groq/Gemini clinical synthesis with strict JSON contracts, patient-context adaptation, and resilient cost-safe fallbacks.

## Current Implementation (Started)

Interaction synthesis now uses a structured prompt and validated response contract in `src/services/interactionSynthesisService.ts`, then merges LLM output into interaction findings in `src/services/rxNormOpenFdaDrugInteractionService.ts`.

### 1) Prompt Template (Structured Input)

LLM receives the exact contract-oriented payload shape:

```text
Drug list: ["warfarin", "ibuprofen"]
Raw interactions: [{ drug1, drug2, severity_code, description }]
Patient context: { age, conditions, renal_function }
Baseline risk level: high|moderate|low
```

Requested LLM tasks:
1. Analyze severity (High/Moderate/Low) with reasoning.
2. Explain clinical mechanism.
3. Provide monitoring recommendations.
4. Suggest safer alternatives for high-risk pairs.
5. Adapt explanation to age, conditions, and renal function.

### 2) Response Parsing and Validation

Response is validated with `zod` before use:
- `overallRisk: low | moderate | high`
- `contextualizedSummary: string`
- `recommendations: string[]`
- `interactionAnalyses[]` with:
  - `drug1`, `drug2`
  - `severity: low | moderate | high`
  - `reasoning`
  - `mechanism`
  - `monitoringRecommendations[]`
  - `saferAlternatives[]`

Validation enforces a safety guardrail: high-severity analyses must include at least one safer alternative.

### 3) Fallback Logic (Provider + Deterministic)

Fallback chain:
1. Groq structured JSON
2. Gemini structured JSON
3. Rule-based deterministic synthesis

If JSON parsing/validation fails for a provider, the next provider is attempted. If all fail, deterministic synthesis returns safe minimum outputs.

### 4) Cost Optimization

Implemented controls:
- Prompt-cache (TTL) keyed by normalized synthesis input hash.
- Interaction batching: all pairwise findings are synthesized in one request.
- Token bounds: interaction payload capped to top `MAX_INTERACTIONS_FOR_PROMPT` entries.
- No-LLM fast path: if there are no interactions, deterministic synthesis is used immediately.

## Next Steps in Phase 5

- Add explicit reasoning-trace metadata output (machine-consumable trace IDs/summary tags).
- Add cost telemetry counters per provider (request count, cache hit rate).
- Extend same strict JSON pattern across other synthesis services.