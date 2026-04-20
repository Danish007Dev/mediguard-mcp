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