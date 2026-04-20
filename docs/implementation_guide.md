# Tool 1 Implementation Guide (Current)

This guide documents the current production-oriented implementation for `check_drug_interactions`.

## Architecture Summary

1. **RxNorm client** for medication normalization and RxCUI mapping.
2. **OpenFDA client** for label-based interaction and warning evidence.
3. **Interaction service** for pairwise matching, severity scoring, and fallback clinical rules.
4. **Synthesis service** with provider resilience:
1. Groq primary
1. Gemini fallback
1. Rule-based summary as final degradation path

## Implemented Files

- `src/clients/rxNormClient.ts`
- `src/clients/openFdaClient.ts`
- `src/clients/groqClient.ts`
- `src/clients/geminiClient.ts`
- `src/services/rxNormOpenFdaDrugInteractionService.ts`
- `src/services/interactionSynthesisService.ts`
- `src/tools/checkDrugInteractions.ts`
- `src/tools/registerTools.ts`

## What This Covers

### 1. Drug normalization (RxNorm)
- Name to RxCUI lookups
- Brand to generic mapping (`Tylenol -> acetaminophen -> 161`)
- Typo handling via spelling suggestions and approximate term fallback
- JSON first, XML fallback parsing
- TTL cache for stable terms

### 2. Interaction evidence retrieval (OpenFDA)
- Brand or generic label search in one query
- Parses both `drug_interactions` and `warnings_and_cautions`
- Collects aliases for stronger matching
- Handles API timeout and failure with structured errors
- TTL cache for repeated lookups

### 3. Interaction inference
- Pairwise matching of medications
- Direct mention matching using aliases
- Drug-class hint matching (e.g., anticoagulant, NSAID)
- Severity classification from evidence language
- Deterministic fallback rules for known high-risk pairs

### 4. Multi-provider synthesis
- Groq is attempted first for concise clinical summary JSON
- Gemini is automatically used if Groq fails/unavailable
- Rule-based synthesis is used if both providers fail/unavailable
- Output includes `analysisProvider` for transparency

## Required Environment Variables

```env
RXNORM_API_URL=https://rxnav.nlm.nih.gov/REST
OPENFDA_API_URL=https://api.fda.gov
API_TIMEOUT_MS=5000
DRUG_CACHE_TTL=86400

GROQ_API_URL=https://api.groq.com/openai/v1
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile

GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash
```

## Next Tooling Step

Proceed to Tool 2 `analyze_polypharmacy` with the same production patterns:

1. Typed client/service boundaries
2. Deterministic safety rules first
3. Groq primary with Gemini fallback for synthesis
4. Rule-based degradation path
5. Contract-first MCP output schemas