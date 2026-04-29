# 🛡️ MediGuard MCP - Medication Safety Intelligence

<p align="center">
  <img src="assets/logo.png" alt="MediGuard Logo" width="200"/>
</p>

[![CI/CD](https://github.com/yourusername/mediguard-mcp/workflows/CI%2FCD/badge.svg)](https://github.com/yourusername/mediguard-mcp/actions)
[![Test Coverage](https://codecov.io/gh/yourusername/mediguard-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/yourusername/mediguard-mcp)
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
git clone https://github.com/yourusername/mediguard-mcp.git
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

MediGuard exposes 5 core medication safety tools via MCP:

### 1. `check_drug_interactions`
Analyzes potential drug-drug interactions across a medication list.

**Input:**
```json
{
  "medications": ["warfarin", "ibuprofen", "aspirin"],
  "patient_context": {
    "patient_id": "patient-123",
    "fhir_endpoint": "https://fhir.example.com",
    "fhir_token": "bearer-token"
  }
}
```

**Output:**
```json
{
  "riskLevel": "high",
  "analysisProvider": "groq",
  "analysisRecommendations": [
    "Avoid routine NSAID use when clinically feasible.",
    "Increase INR and bleeding symptom monitoring if unavoidable."
  ],
  "interactions": [
    {
      "drugs": ["warfarin", "ibuprofen"],
      "severity": "major",
      "mechanism": "NSAIDs increase bleeding risk with anticoagulants",
      "clinicalImpact": "13x increased risk of GI bleeding",
      "recommendations": [
        "Use acetaminophen instead of ibuprofen",
        "If NSAID necessary, add PPI prophylaxis",
        "Monitor INR more frequently"
      ]
    }
  ],
  "summary": "This combination carries significant bleeding risk..."
}
```

### 2. `analyze_polypharmacy`
Evaluates medication regimen for polypharmacy risks using Beers Criteria and STOPP/START.

**Use case:** Elderly patient on 15+ medications  
**Output:** Potentially inappropriate medications, deprescribing opportunities, safer alternatives

### 3. `check_contraindications`
Verifies if proposed medication is safe given patient allergies, conditions, and lab values.

**Use case:** Patient with penicillin allergy prescribed amoxicillin  
**Output:** Cross-reactivity warning, safer antibiotic alternatives

### 4. `get_safer_alternatives`
Recommends therapeutically equivalent but safer alternatives based on patient-specific risks.

**Use case:** High-risk drug interaction identified  
**Output:** Alternative medications with rationale, formulary status

### 5. `explain_medication_safety`
Generates patient-friendly or provider-facing explanations of safety concerns.

**Use case:** Patient education about why medication change is needed  
**Output:** Grade-8 reading level explanation with actionable steps

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
  patient_context: {
    patient_id: 'P12345',
    fhir_endpoint: 'https://ehr.hospital.com/fhir',
    fhir_token: session.token  // Propagated from EHR session
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
    patient_context: patientContext
  });
  
  if (safetyCheck.risk_level === 'high') {
    // Request clinical justification
    return { status: 'needs_review', reason: safetyCheck.explanation };
  }
  
  return { status: 'approved' };
}
```

### Example 2: Discharge Planning Agent

```typescript
// Agent validates discharge medications before patient leaves
async function prepareDischargeMeds(dischargeMeds, patientContext) {
  const polypharmacyCheck = await mediguard.callTool('analyze_polypharmacy', {
    medications: dischargeMeds,
    patient_age: patientContext.age,
    patient_context: patientContext.sharp_context
  });
  
  if (polypharmacyCheck.inappropriate_meds.length > 0) {
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
    patient_context: patient.sharp_context
  });
  
  if (contraindications.is_contraindicated) {
    // Show warning to clinician with alternatives
    showWarning(contraindications.reason);
    suggestAlternatives(contraindications.alternatives);
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
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests
npm run test:safety         # Safety validation tests
npm run test:coverage       # With coverage report
```

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
- **Issues**: [GitHub Issues](https://github.com/yourusername/mediguard-mcp/issues)
- **Email**: your.email@example.com

---

## ⚠️ Disclaimer

MediGuard is a **clinical decision support tool**, not a replacement for professional medical judgment. All medication decisions should be made by licensed healthcare providers with full access to patient information and clinical context.

This software is provided for informational purposes only and should not be used as the sole basis for medical decisions.

---

<div align="center">

**🛡️ Preventing medication errors, one interaction at a time.**

[View Demo](https://youtube.com/your-demo) • [Read Docs](docs/API.md) • [Try It Now](https://promptopinion.ai/marketplace)

</div>
