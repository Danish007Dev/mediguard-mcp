# MediGuard MCP API Reference

This document describes the current MediGuard MCP tool contracts for integration and testing.

## Common Notes

- All tools return MCP `content` and `structuredContent` payloads.
- Tool inputs use snake_case; output fields use camelCase unless noted.
- Tools that accept `sharp_context` can auto-hydrate medications, allergies, or conditions from FHIR.
- Structured errors are returned as MCP errors with a text message in the form `Error [CODE]: message`.

## SHARP Context Object

```json
{
  "patient_id": "patient-123",
  "fhir_endpoint": "https://fhir.example.com",
  "auth_token": "bearer-token",
  "workflow_id": "workflow-1",
  "encounter_id": "encounter-9"
}
```

`auth_token` can also be an OAuth token object with refresh metadata.

## 1) check_drug_interactions

Evaluates pairwise drug interactions and generates risk-level summary recommendations.

### Input

```json
{
  "medications": ["warfarin", "ibuprofen"],
  "patient_context": {
    "age": 72,
    "conditions": ["ckd"],
    "renal_function": "egfr 30"
  },
  "sharp_context": {
    "patient_id": "patient-123",
    "fhir_endpoint": "https://fhir.example.com",
    "auth_token": "bearer-token"
  }
}
```

### Key Output Fields

- `riskLevel`: `low | medium | high | critical`
- `interactions[]`: pair-level findings with severity and evidence
- `analysisProvider`: `groq | gemini | rule-based`
- `analysisRecommendations[]`
- `normalizedMedications[]`
- `llmSynthesis` (optional): provider trace, evidence summaries, and telemetry

## 2) analyze_polypharmacy

Checks Beers-style patterns, duplicate classes, condition-risk overlaps, and burden index.

### Input

```json
{
  "patient_age": 74,
  "patient_conditions": ["heart failure"],
  "current_medications": ["diazepam", "diphenhydramine"],
  "sharp_context": {
    "patient_id": "patient-123",
    "fhir_endpoint": "https://fhir.example.com",
    "auth_token": "bearer-token"
  }
}
```

### Key Output Fields

- `riskLevel`
- `beersFlags[]`
- `duplicateTherapeuticClasses[]`
- `drugBurdenIndex`
- `deprescribingOpportunities[]`

## 3) check_contraindications

Validates allergy-, condition-, lab-, and label-based contraindication concerns for a proposed medication.

### Input

```json
{
  "proposed_medication": "metformin",
  "patient_allergies": ["penicillin"],
  "patient_conditions": ["ckd"],
  "lab_values": { "egfr": 25 },
  "sharp_context": {
    "patient_id": "patient-123",
    "fhir_endpoint": "https://fhir.example.com",
    "auth_token": "bearer-token"
  }
}
```

### Key Output Fields

- `contraindicated`: boolean
- `contraindications[]`: findings with trigger/severity/source
- `labelEvidence`: DailyMed-derived evidence sections
- `analysisRecommendations[]`

## 4) get_safer_alternatives

Returns ranked safer alternatives for a proposed medication and patient-specific risk context.

### Input

```json
{
  "proposed_medication": "ibuprofen",
  "current_medications": ["warfarin"],
  "patient_conditions": ["gi bleed history"],
  "formulary_preferred": ["acetaminophen"],
  "max_alternatives": 3,
  "sharp_context": {
    "patient_id": "patient-123",
    "fhir_endpoint": "https://fhir.example.com",
    "auth_token": "bearer-token"
  }
}
```

### Key Output Fields

- `alternatives[]`: ranked alternatives with `safetyScore`
- `riskContext[]`
- `riskLevel`
- `analysisRecommendations[]`

## 5) explain_medication_safety

Generates patient- or provider-facing explanation content from medication safety findings.

### Input

```json
{
  "audience": "patient",
  "language": "en",
  "medication": "warfarin",
  "risk_level": "high",
  "findings": [
    {
      "issue": "Drug interaction",
      "severity": "major",
      "clinical_impact": "Potential serious bleeding",
      "recommended_action": "Avoid NSAID overlap"
    }
  ],
  "recommendations": ["Use acetaminophen instead of ibuprofen"]
}
```

### Key Output Fields

- `headline`
- `explanation`
- `keyPoints[]`
- `followUpQuestions[]`
- `disclaimer`

## 6) calculate_patient_safety_score

Computes a 0-100 safety score with deduction detail and dashboard-ready artifacts.

### Input

```json
{
  "patient_age": 72,
  "patient_conditions": ["atrial fibrillation"],
  "current_medications": ["warfarin", "ibuprofen", "aspirin"],
  "sharp_context": {
    "patient_id": "patient-123",
    "fhir_endpoint": "https://fhir.example.com",
    "auth_token": "bearer-token"
  }
}
```

### Key Output Fields

- `score`, `grade`, `riskLevel`
- `deductions[]`, `interactionSummary`
- `improvementOpportunities[]`, `potentialOptimizedScore`
- `dashboardArtifact` (score card, severity chart, flags panel)

## 7) simulate_medication_change

Simulates add/remove/replace scenarios and compares safety score deltas before vs after.

### Input

```json
{
  "patient_age": 72,
  "patient_conditions": ["atrial fibrillation"],
  "current_medications": ["warfarin", "ibuprofen"],
  "proposed_change": {
    "action": "replace",
    "drug": "ibuprofen",
    "replacement_drug": "acetaminophen"
  },
  "sharp_context": {
    "patient_id": "patient-123",
    "fhir_endpoint": "https://fhir.example.com",
    "auth_token": "bearer-token"
  }
}
```

### Key Output Fields

- `recommendation`: `safer | riskier | equivalent`
- `current` and `proposed` score summaries
- `delta` score and interaction changes
- `newRisks[]` and `resolvedRisks[]`

## 8) get_decision_trace

Retrieves decision traces for explainability and debugging.

### Input

```json
{
  "tool_name": "check_drug_interactions",
  "status": "error",
  "limit": 5
}
```

### Key Output Fields

- `traces[]`: request metadata, step timing, input/output summaries, and errors

## 9) get_decision_trace_dashboard

Returns aggregate decision-trace metrics for operational dashboards.

### Input

```json
{
  "window_minutes": 1440,
  "limit": 20
}
```

### Key Output Fields

- `summary`: totals and success rate
- `toolBreakdown[]`: per-tool volume and latency
- `recentTraces[]`

## Error Codes (Common)

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `INTERNAL_ERROR`
- `FHIR_API_ERROR`
- `FHIR_TIMEOUT`
- `FHIR_PARSE_ERROR`
- `FHIR_AUTH_REFRESH_ERROR`
- `OPENFDA_API_ERROR`
- `OPENFDA_TIMEOUT`
- `RXNORM_API_ERROR`
- `RXNORM_TIMEOUT`
- `RXNORM_NOT_FOUND`
- `DAILYMED_API_ERROR`
- `DAILYMED_TIMEOUT`
- `PUBMED_API_ERROR`
- `PUBMED_TIMEOUT`
- `GROQ_API_ERROR`
- `GROQ_TIMEOUT`
- `GROQ_PARSE_ERROR`
- `GEMINI_API_ERROR`
- `GEMINI_TIMEOUT`

## Versioning

For release notes and breaking-change history, see [CHANGELOG.md](../CHANGELOG.md).