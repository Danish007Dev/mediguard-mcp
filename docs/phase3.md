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