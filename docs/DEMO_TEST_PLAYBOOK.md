# MediGuard MCP Demo + Test Playbook (After Phase 6 Feature 2)

This guide lets you do two things:
1. Run a real end-to-end product demo of all 9 tools.
2. Verify everything built through Phase 6 Feature 3 baseline (validation, fallback, observability, reliability, dashboard-ready scoring output, and what-if simulation deltas).

## 1) Prerequisites

- Node.js 18+
- npm 9+
- Repository dependencies installed
- Optional for LLM mode:
  - GROQ_API_KEY
  - GEMINI_API_KEY

Environment defaults are loaded from `src/config/env.ts`.

## 2) Start the Server and Inspector

From project root:

npm install
npm run build
npm start

Open a second terminal in the same folder:

npx @modelcontextprotocol/inspector node dist/server.js

In MCP Inspector, connect to the server process and use the 9 tools below.

### 2.1 How to fill fields in MCP Inspector

In Inspector, for each tool call:

1. Select the tool name.
2. Paste a JSON object in the input panel.
3. Click Run.

Important:

- Use only JSON (double quotes everywhere).
- Do not include comments in JSON.
- If a field is optional, you can remove it entirely.
- If you are not testing SHARP/FHIR yet, omit `sharp_context`.
- If you are not using extra patient metadata, omit `patient_context`.

Quick rule:

- Required fields: must be present.
- Optional fields: can be removed.

### 2.2 If Inspector forces a value in sharp_context

Some Inspector views auto-fill optional object fields with invalid values (for example `[]`).

Use this order:

1. Preferred: clear the field completely (empty) and run.
2. If UI refuses empty, use this valid SHARP object:

{
  "patient_id": "example",
  "fhir_endpoint": "https://hapi.fhir.org/baseR4",
  "auth_token": "demo-token"
}

Note: when sharp_context is present, the server will try FHIR hydration.

## 2.3 Left panel field values (exactly what to type)

Use this when the Inspector shows separate fields on the left.

### Tool 1: check_drug_interactions

- medications:

[
  "warfarin",
  "ibuprofen",
  "aspirin"
]

- sharp_context:
  - leave empty, or use the forced-value workaround in section 2.2

- patient_context:

{
  "age": 74,
  "conditions": [
    "atrial fibrillation",
    "chronic kidney disease"
  ],
  "renal_function": "eGFR 42"
}

### Tool 2: analyze_polypharmacy

- patient_age:

79

- patient_conditions:

[
  "heart failure",
  "falls",
  "cognitive impairment"
]

- current_medications:

[
  "diazepam",
  "lorazepam",
  "diphenhydramine",
  "ibuprofen",
  "naproxen",
  "zolpidem"
]

- sharp_context:
  - leave empty, or use section 2.2 object

- patient_context:

{}

### Tool 3: check_contraindications

- proposed_medication:

"amoxicillin"

- patient_allergies:

[
  "penicillin"
]

- patient_conditions:

[
  "chronic kidney disease"
]

- lab_values:

{
  "egfr": 28,
  "creatinine": 2.2
}

- sharp_context:
  - leave empty, or use section 2.2 object

- patient_context:

{}

### Tool 4: get_safer_alternatives

- proposed_medication:

"ibuprofen"

- current_medications:

[
  "warfarin",
  "aspirin"
]

- patient_allergies:

[]

- patient_conditions:

[
  "chronic kidney disease",
  "heart failure"
]

- formulary_preferred:

[
  "acetaminophen",
  "famotidine"
]

- max_alternatives:

3

- sharp_context:
  - leave empty, or use section 2.2 object

- patient_context:

{}

### Tool 5: explain_medication_safety

- audience:

"patient"

- language:

"en"

- medication:

"warfarin"

- risk_level:

"high"

- findings:

[
  {
    "issue": "Drug interaction with ibuprofen",
    "severity": "major",
    "clinical_impact": "Higher risk of serious bleeding",
    "recommended_action": "Avoid routine NSAID overlap"
  }
]

- recommendations:

[
  "Use acetaminophen when appropriate",
  "Monitor INR and bleeding symptoms closely"
]

- sharp_context:
  - leave empty, or use section 2.2 object

- patient_context:

{}

### Tool 6: calculate_patient_safety_score

- patient_age:

82

- patient_conditions:

[
  "atrial fibrillation",
  "chronic kidney disease",
  "fall risk"
]

- current_medications:

[
  "warfarin",
  "ibuprofen",
  "diphenhydramine",
  "diazepam",
  "aspirin"
]

- sharp_context:
  - leave empty, or use section 2.2 object

### Tool 7: simulate_medication_change

- patient_age:

70

- patient_conditions:

[
  "atrial fibrillation"
]

- current_medications:

[
  "warfarin",
  "ibuprofen"
]

- proposed_change:

{
  "action": "replace",
  "drug": "ibuprofen",
  "replacement_drug": "acetaminophen"
}

- sharp_context:
  - leave empty, or use section 2.2 object

### Tool 8: get_decision_trace

- request_id:

"paste a requestId returned from a previous tool call"

- tool_name:

"simulate_medication_change"

- status:

"success"

- limit:

10

### Tool 9: get_decision_trace_dashboard

- tool_name:

"check_drug_interactions"

- window_minutes:

1440

- limit:

20

## 2.4 How to read your first output (what it means)

If you see text like:

- Risk level: high
- analysis: rule-based
- major interactions listed (for example warfarin + ibuprofen)

Your takeaway is:

1. Tool execution succeeded.
2. Clinical risk detection is working.
3. The system is currently using deterministic fallback synthesis (not Groq/Gemini), which is expected if LLM keys are missing, unavailable, or fallback was selected.
4. Patient context was applied if the summary includes age/conditions/renal context.

## 3) Live Demo Script (One Pass, 9 Tools)

Use these payloads exactly in Inspector.

### A) check_drug_interactions

What to enter in each field:

- medications (required): list at least 2 medication names.
- patient_context (optional): adds age/conditions/renal function for better LLM reasoning.
- sharp_context (optional): use only when testing FHIR hydration.

Input:
{
  "medications": ["warfarin", "ibuprofen", "aspirin"],
  "patient_context": {
    "age": 74,
    "conditions": ["atrial fibrillation", "chronic kidney disease"],
    "renal_function": "eGFR 42"
  }
}

Expected signal:
- riskLevel should usually be high or critical
- interactions should include bleeding-risk combinations
- llmSynthesis.trace and llmSynthesis.telemetry should be present

### B) analyze_polypharmacy

What to enter in each field:

- patient_age (required): integer age, for example 79.
- patient_conditions (optional but recommended): risk-driving conditions.
- current_medications (required unless using sharp_context): current medication list.
- sharp_context (optional): FHIR hydration path.
- patient_context (optional): metadata only; not required for baseline run.

Input:
{
  "patient_age": 79,
  "patient_conditions": ["heart failure", "falls", "cognitive impairment"],
  "current_medications": [
    "diazepam",
    "lorazepam",
    "diphenhydramine",
    "ibuprofen",
    "naproxen",
    "zolpidem"
  ]
}

Expected signal:
- beersFlags not empty
- duplicateTherapeuticClasses not empty
- llmTrace and llmTelemetry present

### C) check_contraindications

What to enter in each field:

- proposed_medication (required): the new medication you want to evaluate.
- patient_allergies (optional but recommended): known allergies.
- patient_conditions (optional but recommended): known clinical conditions.
- lab_values (optional): key-value map such as egfr, creatinine, ast, alt.
- sharp_context (optional): pulls allergy/condition context from FHIR.
- patient_context (optional): metadata only.

Input:
{
  "proposed_medication": "amoxicillin",
  "patient_allergies": ["penicillin"],
  "patient_conditions": ["chronic kidney disease"],
  "lab_values": {
    "egfr": 28,
    "creatinine": 2.2
  }
}

Expected signal:
- contraindicated may be true (or high-risk findings present)
- contraindications array populated
- DailyMed-backed evidence fields in labelEvidence
- llmTrace and llmTelemetry present

### D) get_safer_alternatives

What to enter in each field:

- proposed_medication (required): medication to replace.
- current_medications (optional but recommended): active meds that affect risk ranking.
- patient_allergies (optional): avoid allergy-conflicting alternatives.
- patient_conditions (optional): influence renal/cardiac/sedation risk ranking.
- formulary_preferred (optional): list meds your system prefers.
- max_alternatives (required): integer 1 to 10.
- sharp_context (optional): hydration from FHIR.
- patient_context (optional): metadata only.

Input:
{
  "proposed_medication": "ibuprofen",
  "current_medications": ["warfarin", "aspirin"],
  "patient_allergies": [],
  "patient_conditions": ["chronic kidney disease", "heart failure"],
  "formulary_preferred": ["acetaminophen", "famotidine"],
  "max_alternatives": 3
}

Expected signal:
- alternatives should be ranked by safetyScore
- summary and analysisRecommendations should justify choice
- llmTrace and llmTelemetry present

### E) explain_medication_safety

What to enter in each field:

- audience (required): patient or provider.
- language (required): language code, for example en.
- medication (required): medication name.
- risk_level (required): low, medium, high, or critical.
- findings (optional but recommended): structured issues to explain.
- recommendations (optional): action list to include in explanation.
- sharp_context (optional): pulls meds/allergies from FHIR.
- patient_context (optional): metadata only.

Input:
{
  "audience": "patient",
  "language": "en",
  "medication": "warfarin",
  "risk_level": "high",
  "findings": [
    {
      "issue": "Drug interaction with ibuprofen",
      "severity": "major",
      "clinical_impact": "Higher risk of serious bleeding",
      "recommended_action": "Avoid routine NSAID overlap"
    }
  ],
  "recommendations": [
    "Use acetaminophen when appropriate",
    "Monitor INR and bleeding symptoms closely"
  ]
}

Expected signal:
- patient-readable explanation returned
- keyPoints and followUpQuestions populated
- llmTrace and llmTelemetry present

### F) calculate_patient_safety_score

What to enter in each field:

- patient_age (optional but recommended): integer age to activate older-adult risk scoring.
- patient_conditions (optional): known conditions that may influence interaction context.
- current_medications (required unless using sharp_context): active medication list.
- sharp_context (optional): hydration from FHIR if direct med list is unavailable.

Input:
{
  "patient_age": 82,
  "patient_conditions": ["atrial fibrillation", "chronic kidney disease", "fall risk"],
  "current_medications": [
    "warfarin",
    "ibuprofen",
    "diphenhydramine",
    "diazepam",
    "aspirin"
  ]
}

Expected signal:
- score, grade, riskLevel, and potentialOptimizedScore are present
- deductions and interactionSummary are populated
- dashboardArtifact is present with these panels:
  - scoreCard
  - severityChart
  - deductionBreakdown
  - opportunityQueue
  - flagsPanel

### G) simulate_medication_change

What to enter in each field:

- patient_age (optional): age for context-sensitive risk changes.
- patient_conditions (optional): conditions that affect interaction context.
- current_medications (required unless using sharp_context): baseline regimen.
- proposed_change (required): action add/remove/replace with drug details.
- sharp_context (optional): hydration from FHIR if direct list is unavailable.

Input:
{
  "patient_age": 70,
  "patient_conditions": ["atrial fibrillation"],
  "current_medications": ["warfarin", "ibuprofen"],
  "proposed_change": {
    "action": "replace",
    "drug": "ibuprofen",
    "replacement_drug": "acetaminophen"
  }
}

Expected signal:
- recommendation is present (`safer`, `riskier`, or `equivalent`)
- current/proposed snapshots are present with score and interaction count
- delta block includes scoreDelta and interactionDelta
- newRisks and resolvedRisks show interaction changes caused by proposal

### H) get_decision_trace

What to enter in each field:

- request_id (optional): exact UUID from a prior tool response to fetch one trace.
- tool_name (optional): filter list mode by tool name (for example `check_drug_interactions`).
- status (optional): `success` or `error`.
- limit (optional): max number of traces in list mode (1-100).

Input:
{
  "tool_name": "simulate_medication_change",
  "status": "success",
  "limit": 5
}

Expected signal:
- structuredContent.traces array returned
- each trace has inputSummary, outputSummary, and step-level timing
- per-trace status is visible (`success` or `error`)

### I) get_decision_trace_dashboard

What to enter in each field:

- tool_name (optional): filter dashboard to one tool.
- window_minutes (optional): aggregation window in minutes (1 to 10080).
- limit (optional): max recent traces shown (1 to 100).

Input:
{
  "window_minutes": 1440,
  "limit": 20
}

Expected signal:
- summary block with totalTraces, successCount, errorCount, successRate
- toolBreakdown block with avg/p95 duration and volume per tool
- recentTraces block with latest request IDs and durations

## 3.1 Copy-paste minimal inputs (fastest path)

Use these if you want the smallest working payload per tool.

check_drug_interactions
{
  "medications": ["warfarin", "ibuprofen"]
}

analyze_polypharmacy
{
  "patient_age": 79,
  "current_medications": ["diazepam", "diphenhydramine"]
}

check_contraindications
{
  "proposed_medication": "amoxicillin"
}

get_safer_alternatives
{
  "proposed_medication": "ibuprofen",
  "max_alternatives": 3
}

explain_medication_safety
{
  "audience": "patient",
  "language": "en",
  "medication": "warfarin",
  "risk_level": "high"
}

calculate_patient_safety_score
{
  "patient_age": 79,
  "current_medications": ["warfarin", "ibuprofen", "diphenhydramine"]
}

simulate_medication_change
{
  "current_medications": ["warfarin", "ibuprofen"],
  "proposed_change": {
    "action": "replace",
    "drug": "ibuprofen",
    "replacement_drug": "acetaminophen"
  }
}

get_decision_trace
{
  "limit": 5
}

get_decision_trace_dashboard
{
  "window_minutes": 1440,
  "limit": 20
}

## 3.2 Feature 3 Scenario Pack

Use the preloaded What-If examples in:
- `docs/clinical/feature3_demo_scenarios.json`

Each scenario includes:
- baseline medications
- proposed change (`add` / `remove` / `replace`)
- expected recommendation (`safer` / `riskier` / `equivalent`)

## 4) Full Engineering Test Guide (Everything Built So Far)

### A) Quality gates

Run:

npm run type-check
npm run lint
npm test
npm run validate

Expected:
- zero type errors
- zero lint errors
- all tests pass

### B) Suite-level checks

Run:

npm run test:unit
npm run test:integration
npm run test:safety

Purpose:
- unit: core rules, synthesis, schemas
- integration: FHIR and end-to-end flows
- safety: HIPAA/compliance/performance and resilience checks

Feature-specific quick validation:

```bash
npm run validate:feature3
npm run validate:feature4
```

### C) Fallback behavior test (Phase 5 reliability)

Case 1: no LLM keys
- Remove GROQ_API_KEY and GEMINI_API_KEY from .env
- restart server
- run any synthesis-enabled tool (for example check_drug_interactions)

Expected:
- analysisProvider should be rule-based
- output still complete and safe

Case 2: one key only
- set only GROQ_API_KEY, leave Gemini unset
- restart server
- run same payload twice

Expected:
- provider should prefer groq
- second identical call should show cacheHit true in trace (where synthesis trace is exposed)

### D) Caching and telemetry test

- Run the exact same payload twice for each tool.
- Compare llmTrace and llmTelemetry between first and second response.

Expected:
- second response cacheHit true
- cacheHits and cacheHitRate increase in telemetry
- provider call counters reflect actual calls

### E) Validation/error-path test

Try intentionally invalid payloads:
- check_drug_interactions with only one medication
- analyze_polypharmacy with patient_age -1
- get_safer_alternatives with max_alternatives 20

Expected:
- structured validation error returned
- server remains healthy for next calls

## 5) SHARP/FHIR Context Test

You can test SHARP hydration two ways:
1. Use integration tests already in the repo.
2. Use Inspector with sharp_context and reachable FHIR test endpoint.

Recommended quick verification:

npm run test:integration

## 6) Demo Success Checklist

Mark complete when all are true:

- [ ] All 7 tools produce structured responses in Inspector
- [ ] At least one high-risk scenario is correctly flagged
- [ ] At least one contraindication scenario is correctly flagged
- [ ] Safer alternatives are ranked with rationale
- [ ] Explanation tool returns patient-readable output
- [ ] Safety score tool returns score, grade, risk, deductions, and potentialOptimizedScore
- [ ] dashboardArtifact panels are present (scoreCard, severityChart, deductionBreakdown, opportunityQueue, flagsPanel)
- [ ] What-if simulator returns recommendation plus score/interaction deltas
- [ ] llmTrace and llmTelemetry appear in synthesis-enabled outputs
- [ ] validate command passes end-to-end

## 7) If Something Fails

- Rebuild and restart:
  - npm run build
  - npm start
- Run validate to isolate whether failure is type/lint/test or runtime.
- Confirm .env keys and outbound network access for external APIs.

## 8) Manual Clinical Sign-Off (Feature 2 Final Closure)

Engineering and automated tests are complete for Feature 2. The remaining work is clinical review sign-off.

### What you need to do

1. Generate the review worksheet:

```bash
npm run generate:feature2-sheet
```

This creates:
- `docs/clinical/feature2_review_sheet.csv`

2. Assign two reviewers:
- 1 clinical pharmacist
- 1 prescribing clinician

3. Run the starter batch first:
- Review IDs `F2-CHART-001` to `F2-CHART-010`
- Resolve repeated disagreement patterns before scaling to all 100 charts

4. Complete full manual adjudication:
- Review all `F2-CHART-001` to `F2-CHART-100`
- Record tool output vs reviewer judgment in the CSV

5. Compute acceptance metrics:
- Risk tier agreement >= 90%
- Major/contraindicated capture sensitivity = 100%
- Beers precision >= 95% on elderly subset
- Dashboard artifact completeness = 100%

6. Capture sign-off:
- Fill reviewer sign-off blocks in `docs/FEATURE_WORKING_VALIDATION_AND_LOG.md`
- Update Feature 2 status to fully complete in:
  - `docs/FEATURE_WORKING_VALIDATION_AND_LOG.md`
  - `docs/PHASE_6_7_ROADMAP.md`

### Why this is required

"15% remaining" means only human clinical validation is pending. Code-level implementation, tool wiring, tests, and demo payloads are already complete.
