# MediGuard Agent Integration Guide

This guide describes practical integration patterns for healthcare agents that call MediGuard tools over MCP.

## Integration Goals

- Run medication safety checks before finalizing orders or recommendations.
- Use SHARP context to auto-hydrate current medications/allergies/conditions from FHIR.
- Preserve traceability by storing MediGuard risk output and recommendation rationale.

## Recommended Call Order

1. `check_drug_interactions`
2. `analyze_polypharmacy`
3. `check_contraindications`
4. `get_safer_alternatives` (if elevated risk)
5. `explain_medication_safety` (patient/provider communication)

## SHARP Context Pattern

Pass `sharp_context` on each call when patient-linked data is available:

```json
{
  "patient_id": "patient-123",
  "fhir_endpoint": "https://fhir.example.com",
  "auth_token": "bearer-token"
}
```

MediGuard will automatically hydrate patient context for tools that support it.

## Example: Prior Authorization Agent

1. Agent receives proposed medication request.
2. Agent calls `check_drug_interactions` with proposed medication + SHARP context.
3. If `riskLevel` is `high` or `critical`, agent blocks approval and requests clinical review.

## Example: Discharge Planning Agent

1. Agent compiles candidate discharge medication list.
2. Agent calls `analyze_polypharmacy`.
3. Agent calls `check_contraindications` for newly added medications.
4. If concerns are detected, call `get_safer_alternatives` and include options in pharmacist handoff.

## Prompting Guidance for Calling Agents

- Include explicit patient goals and constraints in tool input where available.
- Use deterministic fields from `structuredContent` for decision logic.
- Use generated text in `content` primarily for display.

## Reliability Pattern

- Treat `analysisProvider` as metadata, not a quality score.
- If tool call returns an MCP error, retry once only for transient upstream failures.
- For persistent failures, escalate to manual review and log code/message only.

## Audit and Safety

- Do not store bearer tokens in persistent logs.
- Do not render PHI in non-clinical analytics pipelines.
- Keep a human-in-the-loop decision checkpoint for high-risk outputs.

For full schema details, see [API_REFERENCE.md](API_REFERENCE.md).