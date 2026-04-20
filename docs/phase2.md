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