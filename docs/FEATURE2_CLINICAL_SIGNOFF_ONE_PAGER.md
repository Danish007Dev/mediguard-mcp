# Feature 2 Clinical Sign-Off One Pager

## Purpose
Use this sheet to complete the final manual clinical closure for Feature 2 (`calculate_patient_safety_score`).

## Who Signs
- Clinical pharmacist (required)
- Prescribing clinician (required)

## What To Review
- 100 de-identified charts (`F2-CHART-001` to `F2-CHART-100`)
- Worksheet: `docs/clinical/feature2_review_sheet.csv`
- Tool output fields:
  - score, grade, riskLevel
  - deductions, interactionSummary
  - dashboardArtifact (`scoreCard`, `severityChart`, `deductionBreakdown`, `opportunityQueue`, `flagsPanel`)

## Quick Start
1. Generate or refresh worksheet:

```bash
npm run generate:feature2-sheet
```

2. Complete starter batch first:
- `F2-CHART-001` to `F2-CHART-010`

3. Resolve repeated disagreement patterns.

4. Complete full adjudication for 100 charts.

## Acceptance Thresholds
- Risk-tier agreement >= 90%
- Major/contraindicated capture sensitivity = 100%
- Beers precision (elderly subset) >= 95%
- Dashboard artifact completeness = 100%

## Final Sign-Off Block
- Reviewer role:
- Reviewer name:
- Date:
- Chart sample size:
- Risk-tier agreement (%):
- Major/contraindicated capture sensitivity (%):
- Beers precision on elderly subset (%):
- Dashboard artifact completeness (%):
- Open safety issues:
- Recommendation: approve / conditional approve / reject

## Closeout Actions
After both reviewers sign:
1. Update `docs/FEATURE_WORKING_VALIDATION_AND_LOG.md` sign-off section.
2. Mark Feature 2 fully complete in `docs/PHASE_6_7_ROADMAP.md` and the feature log table.
3. Commit documentation closure record.
