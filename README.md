# 🛡️ MediGuard MCP - Medication Safety Intelligence

<p align="center">
  <img src="assets/logo.png" alt="MediGuard Logo" width="200"/>
</p>

[![CI/CD](https://github.com/danish007dev/mediguard-mcp/workflows/CI%2FCD/badge.svg)](https://github.com/danish007dev/mediguard-mcp/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **An intelligent MCP server that prevents medication errors through AI-powered drug interaction checking, polypharmacy analysis, and contraindication detection.**

Built for the [Agents Assemble Healthcare AI Hackathon](https://agents-assemble.devpost.com/) by Prompt Opinion.

---

## 🎯 The Problem

Every year in the United States:
- **7,000+ deaths** from medication errors
- **1.5 million adverse drug events** requiring treatment
- **$21 billion** in preventable healthcare costs

Most errors happen because:
- Doctors review drug lists in just **4 seconds**
- Manual checking across **20,000+ medications** is impossible
- Drug interactions involve complex clinical reasoning that rules can't capture

---

## 💡 The Solution

**MediGuard** is a specialized MCP (Model Context Protocol) server that acts as an **intelligent medication safety layer** for any healthcare AI agent.

Think of it as a clinical pharmacist that:
- ✅ Checks every prescription in **< 3 seconds**
- ✅ Analyzes interactions across **20,000+ medications**
- ✅ Provides **actionable recommendations** with clinical rationale
- ✅ Works with **any healthcare agent** via open standards

---

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/danish007dev/mediguard-mcp.git
cd mediguard-mcp

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env and add your GROQ_API_KEY and GEMINI_API_KEY

# Build the project
npm run build

# Run the MCP server
npm start
```

### Testing with MCP Inspector

```bash
# In a separate terminal
npx @modelcontextprotocol/inspector node dist/server.js
```

---

## Clinical Safety Disclaimer

MediGuard is a clinical decision-support tool and does not replace licensed clinical judgment.

- Output must be reviewed by a qualified clinician or pharmacist before prescribing decisions.
- The system may miss interactions when source data is incomplete, delayed, or unavailable.
- In emergencies, follow institutional protocols and local standards of care immediately.

See detailed safety language in [docs/SAFETY_DISCLAIMER.md](docs/SAFETY_DISCLAIMER.md).

---

## Documentation

- API reference: [docs/API_REFERENCE.md](docs/API_REFERENCE.md)
- Agent integration patterns: [docs/AGENT_INTEGRATION_GUIDE.md](docs/AGENT_INTEGRATION_GUIDE.md)
- Implementation notes: [docs/implementation_guide.md](docs/implementation_guide.md)
- Development setup: [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md)

---

## 🔧 Available Tools

MediGuard exposes 9 MCP tools for medication safety, optimization, and observability. Full schemas and optional fields are documented in [docs/API_REFERENCE.md](docs/API_REFERENCE.md).

### 1. `check_drug_interactions`
Analyzes potential drug-drug interactions across a medication list.

**Input:**
```json
{
  "medications": ["warfarin", "ibuprofen", "aspirin"],
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

**Returns:** `riskLevel`, `interactions[]`, `analysisRecommendations[]`, `analysisProvider`, `normalizedMedications[]`

### 2. `analyze_polypharmacy`
Evaluates polypharmacy burden using Beers-style flags, duplicate classes, and deprescribing cues.

**Input:**
```json
{
  "patient_age": 74,
  "patient_conditions": ["heart failure"],
  "current_medications": ["diazepam", "diphenhydramine"]
}
```

**Returns:** `riskLevel`, `beersFlags[]`, `duplicateTherapeuticClasses[]`, `drugBurdenIndex`, `deprescribingOpportunities[]`

### 3. `check_contraindications`
Validates proposed medications against allergies, conditions, labs, and DailyMed label evidence.

**Input:**
```json
{
  "proposed_medication": "metformin",
  "patient_allergies": ["penicillin"],
  "patient_conditions": ["ckd"],
  "lab_values": { "egfr": 25 }
}
```

**Returns:** `contraindicated`, `contraindications[]`, `labelEvidence`, `analysisRecommendations[]`

### 4. `get_safer_alternatives`
Ranks safer alternatives using patient risks and optional formulary preferences.

**Input:**
```json
{
  "proposed_medication": "ibuprofen",
  "current_medications": ["warfarin"],
  "patient_conditions": ["gi bleed history"],
  "formulary_preferred": ["acetaminophen"],
  "max_alternatives": 3
}
```

**Returns:** `alternatives[]`, `riskContext[]`, `riskLevel`, `analysisRecommendations[]`

### 5. `explain_medication_safety`
Generates patient- or provider-facing explanations of safety findings.

**Input:**
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

**Returns:** `headline`, `explanation`, `keyPoints[]`, `followUpQuestions[]`, `disclaimer`

### 6. `calculate_patient_safety_score`
Computes a 0-100 safety score with deduction detail and a UI-ready dashboard artifact.

**Input:**
```json
{
  "patient_age": 72,
  "patient_conditions": ["atrial fibrillation"],
  "current_medications": ["warfarin", "ibuprofen", "aspirin"]
}
```

**Returns:** `score`, `grade`, `riskLevel`, `deductions[]`, `interactionSummary`, `dashboardArtifact`

### 7. `simulate_medication_change`
Simulates add/remove/replace scenarios and compares safety score deltas.

**Input:**
```json
{
  "patient_age": 72,
  "patient_conditions": ["atrial fibrillation"],
  "current_medications": ["warfarin", "ibuprofen"],
  "proposed_change": {
    "action": "replace",
    "drug": "ibuprofen",
    "replacement_drug": "acetaminophen"
  }
}
```

**Returns:** `recommendation`, `delta`, `newRisks[]`, `resolvedRisks[]`, `current`, `proposed`

### 8. `get_decision_trace`
Retrieves decision traces for explainability and debugging.

**Input:**
```json
{
  "tool_name": "check_drug_interactions",
  "status": "error",
  "limit": 5
}
```

**Returns:** `traces[]` with step-level timing and summaries

### 9. `get_decision_trace_dashboard`
Returns aggregate decision-trace metrics for operational dashboards.

**Input:**
```json
{
  "window_minutes": 1440,
  "limit": 20
}
```

**Returns:** `summary`, `toolBreakdown[]`, `recentTraces[]`

---

## 🏥 SHARP Extension Support

MediGuard fully supports the SHARP extension for healthcare context propagation, enabling seamless multi-agent workflows.

**What is SHARP?**
- Extension to MCP protocol for healthcare
- Propagates patient context (ID, FHIR endpoint, OAuth tokens)
- Enables secure data access across agent calls

**How it works:**
1. Agent A calls MediGuard with SHARP context
2. MediGuard uses context to fetch patient medications from FHIR server
3. Analysis includes both input meds + patient's current meds
4. Results returned to Agent A for decision-making

**Example:**
```typescript
// Prior Authorization Agent calls MediGuard
const result = await mcpClient.callTool('check_drug_interactions', {
  medications: ['new-prescription'],
  sharp_context: {
    patient_id: 'P12345',
    fhir_endpoint: 'https://ehr.hospital.com/fhir',
    auth_token: session.token // Propagated from EHR session
  }
});

// MediGuard automatically fetches patient's current meds
// and checks against all active medications
```

---

## 🔐 Security & Compliance

### HIPAA Compliance
- ✅ **No PHI storage** - All processing is stateless
- ✅ **No PHI in logs** - Audit trail excludes patient identifiers
- ✅ **Encrypted transmission** - All FHIR calls use HTTPS + OAuth2
- ✅ **Access controls** - Token-based authentication required

### Data Sources
- **RxNorm** (NIH) - Drug normalization and interaction data
- **OpenFDA** - Adverse event reports, drug recalls, safety alerts
- **DailyMed** - FDA-approved drug labeling information
- **FHIR R4** - Patient medication and allergy data (when context provided)

All data sources are **public APIs** - no proprietary databases required.

### LLM Provider Strategy
- **Primary provider:** Groq (fast, low-cost synthesis for tool responses)
- **Fallback provider:** Gemini (automatic failover)
- **Final degradation path:** deterministic rule-based synthesis when both providers are unavailable

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│           ANY HEALTHCARE AI AGENT                │
│  (Prior Auth, Discharge Planning, EHR Copilot)  │
└────────────────┬────────────────────────────────┘
                 │ MCP Protocol
                 ├─ check_drug_interactions()
                 ├─ analyze_polypharmacy()
                 ├─ check_contraindications()
                 ├─ get_safer_alternatives()
                 ├─ explain_medication_safety()
                 ├─ calculate_patient_safety_score()
                 ├─ simulate_medication_change()
                 ├─ get_decision_trace()
                 ├─ get_decision_trace_dashboard()
                 ↓
┌─────────────────────────────────────────────────┐
│         MediGuard MCP Server                     │
├─────────────────────────────────────────────────┤
│  SHARP Extension Support                         │
│  - Patient context propagation                   │
│  - FHIR token handling                           │
│  - Multi-agent workflows                         │
├─────────────────────────────────────────────────┤
│  Intelligence Layer                              │
│  - Groq primary synthesis                        │
│  - Gemini fallback synthesis                     │
│  - Rule-based degradation                        │
│  - Context-aware analysis                        │
│  - Natural language explanations                 │
├─────────────────────────────────────────────────┤
│  Data Integration                                │
│  ├─ RxNorm (drug normalization)                 │
│  ├─ OpenFDA (adverse events)                    │
│  ├─ DailyMed (drug labels)                      │
│  └─ FHIR R4 (patient data)                      │
└─────────────────────────────────────────────────┘
```

![MediGuard MCP tool workflow diagram](assets/MCP%20Tool%20Working%20Diagram.png)

---

## 📖 Integration Examples

### Example 1: Prior Authorization Agent

```typescript
// Agent checks if new prescription is safe before approving
import { McpClient } from '@modelcontextprotocol/sdk';

const mediguard = new McpClient('mediguard-mcp');

async function reviewPriorAuth(prescription, patientContext) {
  const safetyCheck = await mediguard.callTool('check_drug_interactions', {
    medications: [prescription.drug],
    sharp_context: patientContext.sharp_context
  });
  
  if (safetyCheck.riskLevel === 'high' || safetyCheck.riskLevel === 'critical') {
    // Request clinical justification
    return { status: 'needs_review', reason: safetyCheck.summary };
  }
  
  return { status: 'approved' };
}
```

### Example 2: Discharge Planning Agent

```typescript
// Agent validates discharge medications before patient leaves
async function prepareDischargeMeds(dischargeMeds, patientContext) {
  const polypharmacyCheck = await mediguard.callTool('analyze_polypharmacy', {
    current_medications: dischargeMeds,
    patient_age: patientContext.age,
    patient_conditions: patientContext.conditions ?? [],
    sharp_context: patientContext.sharp_context
  });
  
  if (polypharmacyCheck.beersFlags.length > 0 || polypharmacyCheck.deprescribingOpportunities.length > 0) {
    // Flag for pharmacist review
    await notifyPharmacist(polypharmacyCheck);
  }
}
```

### Example 3: EHR Prescription Writer Copilot

```typescript
// Real-time safety checking as clinician types prescription
async function onPrescriptionChange(newDrug, currentMeds, patient) {
  const contraindications = await mediguard.callTool('check_contraindications', {
    proposed_medication: newDrug,
    patient_allergies: patient.allergies,
    patient_conditions: patient.conditions,
    lab_values: patient.labs,
    sharp_context: patient.sharp_context
  });
  
  if (contraindications.contraindicated) {
    // Show warning to clinician with alternatives
    showWarning(contraindications.summary);
    suggestAlternatives(contraindications.analysisRecommendations);
  }
}
```

---

## 🧪 Testing

### Run All Tests
```bash
npm test
```

### Run Specific Test Suites
```bash
npm run test:unit           # Unit tests (32 suites)
npm run test:integration    # Integration tests (FHIR + SHARP flows)
npm run test:safety         # Safety, HIPAA, and performance checks
npx jest tests/e2e          # End-to-end via MCP StdioTransport
npm run test:coverage       # With coverage report
npm run validate:feature3   # What-If Simulator validation
npm run validate:feature4   # Decision Trace validation
```

### Latest Test Results (2026-05-01)

| Suite | Suites | Tests | Status |
|---|---:|---:|---|
| **Unit** | 32 | 208 | ✅ All pass |
| **Integration** | 2 (+1 skip) | 2 (+1 skip) | ✅ All pass |
| **Safety** | 8 | 14 | ✅ All pass |
| **End-to-End** | 1 | 30 | ✅ All pass |
| **Type Check** | — | — | ✅ 0 errors |
| **Lint** | — | — | ✅ 0 errors |
| **Total** | **43** | **254** | **✅ 0 failures** |

E2E tests exercise all 9 MCP tools against real external APIs (RxNorm, OpenFDA, DailyMed, PubMed) via `StdioClientTransport`.

Full run history: [`my-docs/clinical review/FEATURE_WORKING_VALIDATION_AND_LOG.md`](my-docs/clinical%20review/FEATURE_WORKING_VALIDATION_AND_LOG.md)

### Test Coverage Requirements
- Minimum **80%** overall coverage
- **100%** coverage for safety-critical functions
- All known dangerous interactions must be flagged

### Safety Test Cases
We validate against known dangerous interactions:
- ✅ Warfarin + NSAIDs (bleeding risk)
- ✅ Metformin + contrast dye (lactic acidosis)
- ✅ ACE inhibitors + potassium (hyperkalemia)
- ✅ Benzodiazepines in elderly (falls risk)
- ✅ And 20+ more critical combinations

---

## 📊 Performance

**Response Time Targets:**
- Tool execution: **< 3 seconds** (95th percentile)
- RxNorm lookups: **< 500ms** per drug
- FHIR data fetch: **< 1 second**
- LLM synthesis: **< 2 seconds**

**Optimization Techniques:**
- Aggressive caching (drugs don't change often)
- Parallel API calls where possible
- Multi-provider LLM fallback (Groq -> Gemini -> rules)
- Connection pooling for FHIR endpoints

---

## 🚢 Deployment

### Prompt Opinion Marketplace

MediGuard is published on the [Prompt Opinion Marketplace](https://promptopinion.ai/marketplace).

**To use:**
1. Log in to Prompt Opinion
2. Browse marketplace → Search "MediGuard"
3. Click "Add to Workspace"
4. MediGuard tools now available to all agents in your workspace

### Self-Hosting

```bash
# Docker deployment
docker build -t mediguard-mcp .
docker run -p 3000:3000 -e GROQ_API_KEY=your-key -e GEMINI_API_KEY=your-key mediguard-mcp

# Or use npm
npm run build
npm start
```

---

## 📈 Metrics & Monitoring

### Success Metrics
- **Interactions flagged**: Count of dangerous combinations prevented
- **Average response time**: Performance tracking
- **False positive rate**: Quality metric (target: <5%)
- **Agent adoption**: Number of agents using MediGuard

### Audit Logging
All safety checks are logged (without PHI) for:
- Clinical validation
- Performance monitoring
- Continuous improvement
 - Decision trace metrics via `get_decision_trace` and `get_decision_trace_dashboard`

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Areas where we need help:**
- Additional drug interaction databases
- More clinical decision rules (STOPP/START, etc.)
- International drug formularies
- Multi-language support
- Performance optimization

---

## 📜 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Built for the **Agents Assemble Healthcare AI Hackathon** by [Prompt Opinion](https://promptopinion.ai).

**Data Sources:**
- [RxNorm](https://www.nlm.nih.gov/research/umls/rxnorm/) - National Library of Medicine
- [OpenFDA](https://open.fda.gov/) - U.S. Food & Drug Administration
- [DailyMed](https://dailymed.nlm.nih.gov/) - National Library of Medicine

**Technologies:**
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) - Anthropic
- [Groq API](https://console.groq.com/docs/overview) - Groq
- [Gemini API](https://ai.google.dev/) - Google
- [FHIR R4](http://hl7.org/fhir/) - HL7 International

---

## 📞 Contact

- **Demo Video**: [YouTube Link]
- **Devpost**: [Hackathon Submission]
- **Issues**: [GitHub Issues](https://github.com/danish007dev/mediguard-mcp/issues)
- **Email**: contact@danishsolutions.dev

---

## ⚠️ Disclaimer

MediGuard is a **clinical decision support tool**, not a replacement for professional medical judgment. All medication decisions should be made by licensed healthcare providers with full access to patient information and clinical context.

This software is provided for informational purposes only and should not be used as the sole basis for medical decisions.

---

<div align="center">

**🛡️ Preventing medication errors, one interaction at a time.**

[View Demo](https://youtu.be/roVtarkS-gY) • [Read Docs](docs/API_REFERENCE.md) • [Try It Now](https://app.promptopinion.ai/marketplace/mcp/019dee9d-6a14-719a-8f30-4c24477e6a48)

</div>
