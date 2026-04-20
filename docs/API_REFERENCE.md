# MediGuard MCP API Reference

This document describes the current MediGuard MCP tool contracts for integration and testing.

## Common Notes

- All tools return MCP `content` and `structuredContent` payloads.
- All tools accept optional `sharp_context` for SHARP/FHIR auto-hydration.
- Structured error payloads are returned as MCP errors with a text message in the form `Error [CODE]: message`.

## SHARP Context Object

```json
{
  "patient_id": "patient-123",
  "fhir_endpoint": "https://fhir.example.com",
  "auth_token": "bearer-token"
}
```

`auth_token` can also be an OAuth token object with refresh metadata.

## 1) check_drug_interactions

Evaluates pairwise drug interactions and generates risk-level summary recommendations.

### Input

```json
{
  "medications": ["warfarin", "ibuprofen"],
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

## 2) analyze_polypharmacy

Checks Beers-criteria patterns, duplicate classes, condition-risk overlaps, and burden index.

### Input

```json
{
  "patientAge": 74,
  "patientConditions": ["heart failure"],
  "currentMedications": ["diazepam", "diphenhydramine"],
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
  "proposedMedication": "metformin",
  "patientAllergies": ["penicillin"],
  "patientConditions": ["ckd"],
  "labValues": { "egfr": 25 },
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
  "proposedMedication": "ibuprofen",
  "riskContext": ["anticoagulant use", "gi bleed history"],
  "sharp_context": {
    "patient_id": "patient-123",
    "fhir_endpoint": "https://fhir.example.com",
    "auth_token": "bearer-token"
  }
}
```

### Key Output Fields

- `alternatives[]`: ranked alternatives with `safetyScore`
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
  "riskLevel": "high",
  "findings": [
    {
      "issue": "Drug interaction",
      "severity": "major",
      "clinicalImpact": "Potential serious bleeding",
      "recommendedAction": "Avoid NSAID overlap"
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

## Error Codes (Common)

- `VALIDATION_ERROR`
- `FHIR_API_ERROR`
- `FHIR_TIMEOUT`
- `FHIR_PARSE_ERROR`
- `FHIR_AUTH_REFRESH_ERROR`
- `OPENFDA_API_ERROR`
- `OPENFDA_TIMEOUT`
- `RXNORM_NOT_FOUND`

## Versioning

For release notes and breaking-change history, see [CHANGELOG.md](../CHANGELOG.md).