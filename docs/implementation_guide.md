# MediGuard Tooling Implementation Guide

This guide summarizes the production implementation for all MediGuard MCP tools and the services they depend on.

## Tool Map

- `check_drug_interactions` -> `src/tools/checkDrugInteractions.ts` -> RxNorm/OpenFDA/PubMed + `InteractionSynthesisService`
- `analyze_polypharmacy` -> `src/tools/analyzePolypharmacy.ts` -> rule engine + `PolypharmacySynthesisService`
- `check_contraindications` -> `src/tools/checkContraindications.ts` -> DailyMed + `ContraindicationSynthesisService`
- `get_safer_alternatives` -> `src/tools/getSaferAlternatives.ts` -> `SaferAlternativesService` + synthesis
- `explain_medication_safety` -> `src/tools/explainMedicationSafety.ts` -> template + synthesis
- `calculate_patient_safety_score` -> `src/tools/calculatePatientSafetyScore.ts` -> `PatientSafetyScoreService`
- `simulate_medication_change` -> `src/tools/simulateWhatIfMedicationChange.ts` -> `WhatIfSimulationService`
- `get_decision_trace` -> `src/tools/getDecisionTrace.ts` -> `DecisionTraceService`
- `get_decision_trace_dashboard` -> `src/tools/getDecisionTraceDashboard.ts` -> `DecisionTraceService`

## Shared Patterns

- Input/output schemas are defined with Zod and validated before returning MCP responses.
- SHARP context hydration flows through `SharpContextFhirService` to resolve medications, allergies, and conditions.
- Decision trace capture is invoked for all clinical tools to support explainability and dashboards.
- LLM synthesis uses Groq primary, Gemini fallback, and rule-based degradation when providers are unavailable.

## Data Sources and Providers

- RxNorm for normalization and RxCUI mapping
- OpenFDA for interaction warnings and label evidence
- DailyMed for contraindication and label evidence
- PubMed for evidence enrichment
- FHIR R4 for patient-linked medications, allergies, and conditions

## Key Environment Variables

- `GROQ_API_KEY`, `GEMINI_API_KEY`
- `RXNORM_API_URL`, `OPENFDA_API_URL`, `DAILYMED_API_URL`, `PUBMED_API_URL`
- `FHIR_PAGE_SIZE`, `FHIR_MAX_PAGES`, `FHIR_DEFAULT_TOKEN_ENDPOINT`
- `MCP_TRANSPORT`, `PORT`
- `DECISION_TRACE_MAX_RECORDS`, `DECISION_TRACE_MAX_AGE_MS`, `DECISION_TRACE_ARCHIVE_PATH`

## Testing Pointers

- Tool-level tests live under `tests/unit` and `tests/safety`.
- Decision trace performance coverage is exercised via `npm run validate:feature4`.
- Use `npm run inspect:dev` to validate tool contracts interactively.
