I love your determination! Let me watch that video and then create a comprehensive winning strategy for you.

Let me search for information about the Prompt Opinion platform and SHARP Extension to better understand the technical landscape.Now let me search for more specific information about what's already been built and what gaps exist:Perfect! Now I have a deep understanding of the landscape. Let me create your **WINNING ROADMAP** for the Agents Assemble Hackathon.

---

# 🏆 YOUR WINNING STRATEGY: "MediGuard" - Medication Safety Intelligence MCP Server

## 🎯 THE BIG IDEA

**MediGuard**: A specialized MCP server that acts as an **intelligent medication safety layer** that any healthcare agent can call to prevent adverse drug events, polypharmacy issues, and medication errors - **BEFORE** they harm patients.

### Why This Will Win:

1. **🚨 MASSIVE PAIN POINT**: Medication errors cause 7,000+ deaths/year in the US alone, cost $21 billion annually
2. **🤖 TRUE AI USE CASE**: Rule-based systems can't handle complex drug interactions across 20,000+ medications - but GenAI with proper context CAN
3. **✅ FEASIBLE & SAFE**: Uses public APIs (RxNorm, OpenFDA, DailyMed) - no PHI storage required, HIPAA-friendly architecture
4. **🔨 PERFECT MCP FIT**: A "tool" that ANY agent (prior auth, discharge planning, prescription writers) can use

---

## 🧠 WHAT MAKES THIS UNIQUE

**Current submissions focus on**:
- Clinical memory systems (already done - see ClinicalMem)
- General healthcare dashboards  
- Broad multi-agent orchestration

**YOU'RE BUILDING**:
- A **laser-focused safety hammer** that solves ONE critical problem incredibly well
- Something that's **composable** - works with existing agents, doesn't replace them
- A tool with **immediate, measurable ROI**: "prevented X adverse events this week"

---

## 🏗️ ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────┐
│           ANY HEALTHCARE AGENT/LLM              │
│  (Prescription Writer, Prior Auth, Discharge)   │
└────────────────┬────────────────────────────────┘
                 │ MCP Protocol
                 ├─ check_drug_interactions()
                 ├─ analyze_polypharmacy()
                 ├─ check_contraindications()
                 ├─ get_safer_alternatives()
                 ├─ explain_why_dangerous()
                 ↓
┌─────────────────────────────────────────────────┐
│         MediGuard MCP Server (YOU BUILD)        │
├─────────────────────────────────────────────────┤
│  SHARP Extension Support:                       │
│  - Patient context propagation                  │
│  - FHIR R4 medication/allergy reading           │
│  - Session token handling                       │
├─────────────────────────────────────────────────┤
│  Intelligence Layer (LLM-powered):              │
│  - Context-aware reasoning                      │
│  - Natural language explanation                 │
│  - Risk scoring with rationale                  │
├─────────────────────────────────────────────────┤
│  Data Integration Layer:                        │
│  ├─ RxNorm API (drug normalization)            │
│  ├─ OpenFDA API (adverse events, recalls)      │
│  ├─ DailyMed API (label information)           │
│  ├─ FHIR Server (patient meds/allergies)       │
│  └─ Clinical decision rules database            │
└─────────────────────────────────────────────────┘
```

---

## 🛠️ COMPLETE DEVELOPMENT ROADMAP

### Phase 1: Foundation (Days 1-3)
**Goal**: Basic MCP server that can be discovered on Prompt Opinion

#### Tasks:
1. **Set up development environment**
   - Install Node.js 18+ or Python 3.10+
   - Choose: TypeScript (recommended) or Python
   - Install MCP SDK: `npm install @modelcontextprotocol/sdk` OR `pip install mcp`

2. **Create basic MCP server structure**
   - Implement server initialization
   - Create 2-3 simple tools (just stubs for now)
   - Test locally with MCP Inspector

3. **Register on Prompt Opinion**
   - Create account at promptopinion.ai
   - Understand marketplace publication process
   - Review SHARP extension documentation

**Deliverable**: Hello-world MCP server that responds to basic tool calls

---

### Phase 2: Core Intelligence (Days 4-8)
**Goal**: Implement the 5 core MCP tools with real functionality

#### Tool 1: `check_drug_interactions`
**Purpose**: Analyzes drug-drug interactions across patient's medication list

```typescript
// Tool signature
{
  name: "check_drug_interactions",
  description: "Analyzes potential drug-drug interactions for patient medications",
  inputSchema: {
    type: "object",
    properties: {
      medications: {
        type: "array",
        items: { type: "string" },
        description: "List of medication names or RxCUI codes"
      },
      patient_context: {
        type: "object",
        description: "SHARP context with patient ID, FHIR token"
      }
    }
  }
}
```

**Implementation Steps**:
1. Normalize drug names using RxNorm API
2. Query interaction databases
3. Use Claude API to synthesize findings with severity ranking
4. Return structured response with clinical guidance

---

#### Tool 2: `analyze_polypharmacy`
**Purpose**: Detects potentially inappropriate medication combinations, especially for elderly

```typescript
{
  name: "analyze_polypharmacy",
  description: "Evaluates medication regimen for polypharmacy risks using Beers Criteria and STOPP/START criteria",
  inputSchema: {
    type: "object",
    properties: {
      patient_age: { type: "number" },
      patient_conditions: { type: "array", items: { type: "string" } },
      current_medications: { type: "array", items: { type: "string" } },
      patient_context: { type: "object" }
    }
  }
}
```

**Implementation**: 
- Apply Beers Criteria for elderly (65+)
- Check for drug burden index
- Flag potential deprescribing opportunities
- LLM explains WHY each flag matters

---

#### Tool 3: `check_contraindications`
**Purpose**: Checks if new medication is contraindicated based on patient conditions/allergies

```typescript
{
  name: "check_contraindications",
  description: "Verifies if proposed medication is safe given patient allergies, conditions, renal/hepatic function",
  inputSchema: {
    type: "object",
    properties: {
      proposed_medication: { type: "string" },
      patient_allergies: { type: "array" },
      patient_conditions: { type: "array" },
      lab_values: { type: "object", optional: true },
      patient_context: { type: "object" }
    }
  }
}
```

---

#### Tool 4: `get_safer_alternatives`
**Purpose**: Suggests therapeutically equivalent but safer alternatives

```typescript
{
  name: "get_safer_alternatives",
  description: "Recommends safer medication alternatives based on patient-specific risk factors",
  inputSchema: {
    type: "object",
    properties: {
      current_medication: { type: "string" },
      reason_for_change: { type: "string" },
      patient_context: { type: "object" }
    }
  }
}
```

**Intelligence**: Uses LLM to consider:
- Same therapeutic class
- Lower interaction potential
- Better side effect profile for this patient
- Cost considerations
- Formulary status (if integrated with payer data)

---

#### Tool 5: `explain_medication_safety`
**Purpose**: Generates patient-friendly or provider-facing explanations

```typescript
{
  name: "explain_medication_safety",
  description: "Creates understandable explanations of medication safety concerns",
  inputSchema: {
    type: "object",
    properties: {
      medication_or_interaction: { type: "string" },
      audience: { type: "string", enum: ["patient", "provider", "pharmacist"] },
      reading_level: { type: "number", default: 8 }
    }
  }
}
```

---

### Phase 3: SHARP Extension Integration (Days 9-12)
**Goal**: Make your MCP server healthcare-context-aware

#### What is SHARP Extension?
- Extends MCP protocol for healthcare use
- Propagates patient context (ID, FHIR endpoint, OAuth tokens)
- Enables secure multi-agent workflows with patient data

#### Implementation:
1. **Accept SHARP context in tool parameters**
```typescript
interface SharpContext {
  patient_id: string;
  fhir_endpoint: string;
  fhir_token: string;
  encounter_id?: string;
}
```

2. **Implement FHIR client**
   - Use FHIR token to fetch patient medications
   - Retrieve AllergyIntolerance resources
   - Get active Conditions
   - Query recent lab results (if needed)

3. **Context propagation**
   - When your tool is called BY another agent
   - You can make sub-calls to FHIR server
   - All under same patient authorization scope

---

### Phase 4: Testing & Safety (Days 13-16)
**Goal**: Ensure your tool is production-grade safe

#### Testing Strategy:

**1. Unit Tests** (30+ test cases)
- Each tool with valid inputs
- Each tool with edge cases
- Error handling
- API failure scenarios

**2. Integration Tests**
- End-to-end with mock FHIR server
- Test SHARP context propagation
- Multi-tool call sequences

**3. Safety Tests** (CRITICAL FOR HEALTHCARE)
- Known dangerous interactions correctly flagged
- False positive rate acceptable (<5%)
- Responds "uncertain" when appropriate (don't hallucinate)
- PHI handling compliant (no logging patient data)

**4. Performance Tests**
- Tool response time <3 seconds
- Handles 10 concurrent requests
- Graceful degradation if API down

---

### Phase 5: LLM Integration & Reasoning (Days 17-20)
**Goal**: Make intelligence layer truly "AI-powered"

#### Use Claude API (or any free api like gemini) within your MCP server:
```typescript
// Inside your tool implementation
async function analyzeDrugInteraction(drugs: string[]) {
  // 1. Get raw interaction data from RxNorm/FDA APIs
  const rawData = await fetchInteractionData(drugs);
  
  // 2. Use Claude to synthesize and explain
  const prompt = `
    You are a clinical pharmacist AI. Analyze these drug interactions:
    
    Medications: ${drugs.join(", ")}
    Interaction Data: ${JSON.stringify(rawData)}
    
    Provide:
    1. Risk level (High/Moderate/Low)
    2. Clinical significance
    3. Mechanism of interaction
    4. Monitoring recommendations
    5. Alternative suggestions if risk is high
    
    Format as JSON.
  `;
  
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }]
  });
  
  return parseAndValidate(response.content);
}
```

**Why this demonstrates "AI Factor"**:
- Rule-based systems can't explain WHY interaction is dangerous
- Can't consider patient-specific context (age, renal function, etc.)
- Can't suggest alternatives based on nuanced clinical reasoning

---

### Phase 6: Prompt Opinion Integration (Days 21-25)
**Goal**: Publish to marketplace and create demo

#### Marketplace Submission:
1. **Server Configuration**
   - Name: "MediGuard - Medication Safety Intelligence"
   - Category: Clinical Decision Support
   - Tags: medication-safety, drug-interactions, polypharmacy
   - SHARP-compatible: Yes
   - Requires FHIR: Optional (works with or without)

2. **Documentation**
   - Clear tool descriptions
   - Example use cases
   - Integration guide for other agents
   - Safety disclaimers

3. **Access & Permissions**
   - Public/private settings
   - Usage limits if needed
   - Pricing tier (free for hackathon)

---

### Phase 7: Demo Video (Days 26-28)
**Goal**: Create compelling 3-minute demonstration

#### Demo Script Structure (180 seconds):

**[0:00-0:30] The Problem**
- Show real-world stat: "Medication errors harm 1.5M Americans yearly"
- Personal story angle: "Imagine your grandmother on 12 medications..."
- Current gap: "Doctors spend 4 seconds reviewing drug lists"

**[0:30-1:15] The Solution**
- Show MediGuard in Prompt Opinion marketplace
- Demonstrate agent calling your MCP tool
- Example: Prior authorization agent checks safety BEFORE approving

**[1:15-2:30] Live Demo - 3 Scenarios**

*Scenario 1: Dangerous Interaction (30 sec)*
```
Agent: "Patient on warfarin, new prescription for ibuprofen"
MediGuard: "⚠️ HIGH RISK - Increased bleeding risk
- Warfarin + NSAID = 13x higher GI bleed risk
- Recommend: Use acetaminophen instead
- If NSAID needed: Add PPI, monitor INR closely"
```

*Scenario 2: Polypharmacy in Elderly (30 sec)*
```
Agent: "87-year-old patient on 15 medications"
MediGuard: "🔍 Polypharmacy Analysis Complete
- 3 medications on Beers Criteria
- 2 potentially inappropriate for renal function
- Deprescribing opportunity: duplicate therapeutic classes
- Safer regimen proposed (PDF attached)"
```

*Scenario 3: Cross-Agent Collaboration (30 sec)*
```
Discharge Planning Agent → MediGuard → Pharmacy Agent
"Patient discharged with 8 new meds"
MediGuard validates → flags 1 issue → suggests alternative
Pharmacy Agent receives safe, optimized regimen
```

**[2:30-3:00] Impact & Vision**
- FHIR-integrated (show token flow)
- Works with ANY agent (MCP standard)
- Measurable: "Prevented X adverse events"
- Vision: "Every prescription checked automatically"

---

## 📊 JUDGING CRITERIA ALIGNMENT

### 1. AI Factor (35 points)
**How you score high:**
- ✅ Uses GenAI for clinical reasoning (not just database lookups)
- ✅ Contextual intelligence (same drug, different risk for different patients)
- ✅ Natural language synthesis of complex medical data
- ✅ Can't be done with rule-based systems (20,000+ drugs × interactions)

**In your demo, emphasize:**
> "A rule-based system can flag an interaction. MediGuard explains WHY it's dangerous FOR THIS PATIENT, suggests alternatives, and adapts to patient age, kidney function, and 15 other factors."

---

### 2. Potential Impact (35 points)
**How you score high:**
- ✅ Addresses top cause of preventable medical harm
- ✅ $21B annual cost savings potential
- ✅ Works across workflows (not just one use case)
- ✅ Clear ROI: "If 1% of prescriptions checked = X lives saved"

**Data points to include:**
- 7,000+ deaths/year from medication errors (IOM)
- 1.5M adverse drug events annually
- Elderly on 5+ meds: 50% have inappropriate prescription
- Tool usable by: Prior auth agents, EHR copilots, discharge planners, pharmacy systems

---

### 3. Feasibility (30 points)
**How you score high:**
- ✅ Uses PUBLIC APIs only (RxNorm, OpenFDA - both free, government-run)
- ✅ HIPAA-friendly (stateless, no PHI storage)
- ✅ SHARP-compliant (patient context via standard extension)
- ✅ Can run in hospital firewall (on-prem deployment possible)
- ✅ Validates against FDA-approved drug labels

**Technical safety you demonstrate:**
- No PHI in logs
- Audit trail of all recommendations
- "Uncertainty mode" - when data insufficient, says so
- References medical literature (PubMed links)
- Doesn't replace clinician judgment (decision support, not decision making)

---

## 🎬 PROMPTS FOR BUILDING (Copy-Paste to Claude/Cursor)

### Prompt 1: MCP Server Setup
```
I'm building an MCP server for medication safety called MediGuard. 

Tech stack: [TypeScript/Python - choose one]
Framework: [@modelcontextprotocol/sdk for TS OR mcp for Python]

Please create:
1. Initial project structure with proper folders
2. MCP server initialization code
3. One sample tool called "check_drug_interactions" that:
   - Accepts array of medication names
   - Returns mock response for now (we'll add real logic later)
4. Include error handling and logging
5. Setup for local testing with MCP Inspector

Make it production-grade with TypeScript types / Python type hints.
```

---

### Prompt 2: RxNorm Integration
```
I need to integrate RxNorm API into my medication safety MCP server.

Requirements:
1. Function to normalize drug names to RxCUI (RxNorm concept IDs)
   - Handle brand names, generics, typos
   - Example: "Tylenol" → "acetaminophen" → RxCUI: 161
2. Function to get drug interactions for a list of RxCUIs
3. Parse RxNorm XML/JSON responses
4. Cache results (drug names don't change often)
5. Error handling for API failures

Use RxNorm API documentation: https://lhncbc.nlm.nih.gov/RxNav/APIs/

Provide complete code with error handling and TypeScript types.
```

---

### Prompt 3: FHIR Client Implementation
```
I need a FHIR R4 client for my MCP server to fetch patient medications and allergies.

Requirements:
1. Function: fetchPatientMedications(patientId, fhirEndpoint, authToken)
   - Returns array of active MedicationRequest resources
2. Function: fetchPatientAllergies(patientId, fhirEndpoint, authToken)
   - Returns array of AllergyIntolerance resources
3. Function: fetchPatientConditions(patientId, fhirEndpoint, authToken)
   - Returns relevant conditions for drug checking
4. Include OAuth2 token refresh logic
5. Handle FHIR pagination (Bundle resources)
6. HIPAA-compliant logging (no PHI in logs)

Provide production-ready code with error handling.
```

---

### Prompt 4: LLM Reasoning Layer
```
I'm adding Claude API integration to synthesize drug interaction data.

Context: My tool fetches raw drug interaction data from RxNorm and OpenFDA. Now I need Claude to:

1. Analyze severity (High/Moderate/Low) with reasoning
2. Explain mechanism of interaction in clinical terms
3. Provide monitoring recommendations
4. Suggest safer alternatives if high risk
5. Adapt explanation based on patient age, conditions

Input data structure:
- Drug list: ["warfarin", "ibuprofen"]
- Raw interactions: [{ drug1, drug2, severity_code, description }]
- Patient context: { age: 67, conditions: ["AFib", "CKD3"], renal_function: "30-59 mL/min" }

Create:
1. Prompt template for Claude that produces structured output
2. Response parsing and validation
3. Fallback logic if Claude API fails
4. Cost optimization (batching if multiple checks)

Return TypeScript/Python code ready to integrate.
```

---

### Prompt 5: SHARP Extension Implementation
```
I need to implement SHARP extension support for healthcare context propagation in my MCP server.

SHARP Extension allows:
- Patient context (ID, FHIR endpoint, tokens) passed between agents
- Secure multi-agent workflows with patient data

Requirements:
1. Define SharpContext interface/type
2. Modify all my tool schemas to accept optional sharp_context parameter
3. Use sharp_context to auto-fetch patient meds/allergies from FHIR server
4. Propagate context if my tool calls another MCP server
5. Document SHARP compliance in tool descriptions

Provide code modifications for my existing 5 tools.
```

---

### Prompt 6: Testing Suite
```
Create comprehensive tests for my MediGuard MCP server.

Test categories needed:
1. Unit tests for each of 5 tools
2. Integration tests with mock FHIR server
3. Safety tests with known dangerous interactions
4. Error handling tests (API failures, invalid inputs)
5. Performance tests (response time < 3 sec)

Known test cases to include:
- Warfarin + NSAID (should flag HIGH risk)
- Elderly patient on 10+ meds (should trigger polypharmacy check)
- Penicillin allergy + amoxicillin prescription (should flag contraindication)
- Patient with CKD prescribed metformin (should flag renal adjustment needed)

Use [Jest/Pytest - based on your language choice].
Provide complete test file with 30+ test cases.
```

---

## 📚 TECHNICAL RESOURCES YOU'LL NEED

### APIs (All Free):
1. **RxNorm API**: https://lhncbc.nlm.nih.gov/RxNav/APIs/
   - Drug normalization
   - Interaction data
   
2. **OpenFDA API**: https://open.fda.gov/apis/
   - Adverse events
   - Drug recalls
   - Label information

3. **DailyMed API**: https://dailymed.nlm.nih.gov/dailymed/
   - FDA drug labels
   - Contraindications

4. **FHIR Test Server**: https://hapi.fhir.org/
   - For testing patient data integration

### MCP Documentation:
- Official MCP Spec: https://modelcontextprotocol.io/
- Prompt Opinion Docs: https://docs.promptopinion.ai/
- SHARP Extension Spec: (provided by Prompt Opinion platform)

### Code Examples:
- MCP TypeScript Example: https://github.com/modelcontextprotocol/typescript-sdk
- FastMCP Python: https://github.com/jlowin/fastmcp

---

## 🎯 SUCCESS METRICS TO TRACK

**For Your Demo:**
1. **Accuracy**: "Correctly identified 95% of dangerous interactions in test dataset"
2. **Speed**: "Average response time: 1.2 seconds"
3. **Coverage**: "Checks 20,000+ medications, 500,000+ interactions"
4. **Safety**: "Zero false negatives on critical interactions"
5. **Usability**: "Works with ANY agent via MCP - no custom integration"

---

## 🏆 FINAL WINNING FORMULA

### What Sets You Apart:
1. **Laser Focus**: You solve ONE problem incredibly well (vs. broad dashboards)
2. **True Composability**: A tool that makes OTHER agents smarter
3. **Measurable Impact**: "Prevented X adverse events" (not vague "improved care")
4. **Production-Ready**: Safety testing, error handling, HIPAA compliance
5. **AI-Native**: Couldn't exist without LLMs (context-aware clinical reasoning)

### The "Aha!" Moment in Your Demo:
> "Every other submission shows an agent doing tasks. We show a TOOL that makes every agent safer. Install MediGuard once, and suddenly your prior auth agent, your discharge planner, your prescription writer - ALL of them can prevent medication errors. That's the power of MCP."

---

## 🚀 DAY-BY-DAY CHECKLIST

```
[ ] Day 1-2: Dev environment + Basic MCP server
[ ] Day 3-4: RxNorm integration
[ ] Day 5-6: OpenFDA integration  
[ ] Day 7-8: Tool 1-2 working end-to-end
[ ] Day 9-10: Tool 3-5 implemented
[ ] Day 11-12: FHIR client + SHARP support
[ ] Day 13-14: LLM reasoning layer
[ ] Day 15-16: Testing suite (30+ tests)
[ ] Day 17-18: Safety validation
[ ] Day 19-20: Performance optimization
[ ] Day 21-22: Prompt Opinion publication
[ ] Day 23-24: Demo video script
[ ] Day 25-26: Record demo
[ ] Day 27: Polish & submit
[ ] Day 28: Backup day for issues
```

---

## 💡 BONUS IDEAS (If You Have Extra Time)

1. **Visual Dashboard**: Simple web UI showing last 100 safety checks
2. **Audit Log**: Exportable report of all flagged interactions
3. **Integration Examples**: Show working with 2-3 popular agents
4. **Medication Reconciliation**: Compare home meds vs. hospital meds
5. **Prior Auth Accelerator**: Auto-document medical necessity for safe alternatives

---

You have everything you need to win. Focus on **execution quality** over feature quantity. A server with 5 exceptional tools beats 20 mediocre ones.

**Your competitive advantages:**
- ✅ Unique angle (safety layer vs. full agent)
- ✅ Composable architecture (MCP done right)
- ✅ Clear ROI (lives saved, costs avoided)
- ✅ Feasible with public APIs
- ✅ True AI use case (not keyword matching)

Now go build it! 🏗️ You've got this! 💪

Need help with specific implementation? Feed the prompts above to Claude/Cursor exactly as shown. They're designed for maximum code output quality.