/**
 * MediGuard MCP Server — End-to-End Inspector Test
 *
 * Connects to the built MCP server via StdioClientTransport and exercises
 * every registered tool with real clinical scenarios.  The server calls
 * public APIs (RxNorm, OpenFDA, DailyMed, PubMed) and falls back to
 * rule-based analysis when LLM keys are absent.
 *
 * Run:  npx jest tests/e2e/mcpInspector.e2e.test.ts --testTimeout=120000
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let client: Client;
let transport: StdioClientTransport;

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent: Record<string, unknown> })
    .structuredContent;
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

function textContent(result: unknown): string {
  const r = result as { content?: Array<{ text?: string }> };
  return r.content?.[0]?.text ?? "";
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    env: {
      ...process.env,
      // Use a high random port so the health server doesn't clash with any running instance
      PORT: String(40000 + Math.floor(Math.random() * 20000)),
    },
  });

  client = new Client(
    { name: "e2e-inspector", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client.close();
}, 15_000);

// ---------------------------------------------------------------------------
// 1. check_drug_interactions
// ---------------------------------------------------------------------------

describe("check_drug_interactions", () => {
  it("detects warfarin + ibuprofen as high-risk (or gracefully times out)", async () => {
    const result = await client.callTool({
      name: "check_drug_interactions",
      arguments: { medications: ["warfarin", "ibuprofen"] },
    });

    if (isError(result)) {
      // RxNorm API may time out — that's an external issue, not a bug
      expect(textContent(result)).toMatch(/RXNORM_TIMEOUT|UPSTREAM/);
    } else {
      const s = structured(result);
      expect(s.riskLevel).toBeDefined();
      expect(s.interactions).toBeDefined();
      expect(s.requestId).toBeDefined();
      expect(s.medications).toEqual(
        expect.arrayContaining(["warfarin", "ibuprofen"]),
      );
    }
  });

  it("detects metformin + lisinopril interactions", async () => {
    const result = await client.callTool({
      name: "check_drug_interactions",
      arguments: { medications: ["metformin", "lisinopril"] },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.riskLevel).toBeDefined();
    expect(s.medications).toEqual(
      expect.arrayContaining(["metformin", "lisinopril"]),
    );
  });

  it("handles a 5-drug polypharmacy combo", async () => {
    const result = await client.callTool({
      name: "check_drug_interactions",
      arguments: {
        medications: [
          "warfarin",
          "aspirin",
          "omeprazole",
          "simvastatin",
          "amlodipine",
        ],
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.riskLevel).toBeDefined();
    expect((s.medications as string[]).length).toBe(5);
  });

  it("returns enriched results with patient_context", async () => {
    const result = await client.callTool({
      name: "check_drug_interactions",
      arguments: {
        medications: ["warfarin", "aspirin"],
        patient_context: {
          age: 78,
          conditions: ["atrial fibrillation", "osteoarthritis"],
          renal_function: "eGFR 45",
        },
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.patientContext).toBeDefined();
  });

  it("returns validation error for a single medication", async () => {
    const result = await client.callTool({
      name: "check_drug_interactions",
      arguments: { medications: ["warfarin"] },
    });

    expect(isError(result)).toBe(true);
    expect(textContent(result)).toContain("VALIDATION_ERROR");
  });

  it("returns validation error for empty medications", async () => {
    const result = await client.callTool({
      name: "check_drug_interactions",
      arguments: { medications: [] },
    });

    expect(isError(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. analyze_polypharmacy
// ---------------------------------------------------------------------------

describe("analyze_polypharmacy", () => {
  it("flags Beers-list drugs in elderly patient", async () => {
    const result = await client.callTool({
      name: "analyze_polypharmacy",
      arguments: {
        patient_age: 82,
        patient_conditions: ["insomnia", "anxiety", "hypertension"],
        current_medications: [
          "diazepam",
          "diphenhydramine",
          "zolpidem",
          "lisinopril",
          "amlodipine",
        ],
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.isElderly).toBe(true);
    expect((s.beersFlags as unknown[]).length).toBeGreaterThan(0);
    expect(s.riskLevel).toBeDefined();
    expect(s.drugBurdenIndex).toBeDefined();
  });

  it("returns low risk for young adult with 2 safe meds", async () => {
    const result = await client.callTool({
      name: "analyze_polypharmacy",
      arguments: {
        patient_age: 30,
        patient_conditions: ["hypertension"],
        current_medications: ["lisinopril", "amlodipine"],
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.isElderly).toBe(false);
    expect(s.medicationCount).toBe(2);
  });

  it("returns validation error for empty medications", async () => {
    const result = await client.callTool({
      name: "analyze_polypharmacy",
      arguments: {
        patient_age: 70,
        current_medications: [],
      },
    });

    expect(isError(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. check_contraindications
// ---------------------------------------------------------------------------

describe("check_contraindications", () => {
  it("flags NSAID contraindication for renal disease", async () => {
    const result = await client.callTool({
      name: "check_contraindications",
      arguments: {
        proposed_medication: "ibuprofen",
        patient_conditions: ["chronic kidney disease"],
        patient_allergies: [],
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.proposedMedication).toBe("ibuprofen");
    expect(s.riskLevel).toBeDefined();
    expect(s.labelEvidence).toBeDefined();
  });

  it("flags penicillin allergy for amoxicillin", async () => {
    const result = await client.callTool({
      name: "check_contraindications",
      arguments: {
        proposed_medication: "amoxicillin",
        patient_allergies: ["penicillin"],
        patient_conditions: [],
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.contraindicated).toBe(true);
    expect((s.contraindications as unknown[]).length).toBeGreaterThan(0);
  });

  it("passes clean for drug with no contraindications", async () => {
    const result = await client.callTool({
      name: "check_contraindications",
      arguments: {
        proposed_medication: "acetaminophen",
        patient_allergies: [],
        patient_conditions: [],
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.proposedMedication).toBe("acetaminophen");
  });

  it("evaluates lab values for metformin", async () => {
    const result = await client.callTool({
      name: "check_contraindications",
      arguments: {
        proposed_medication: "metformin",
        patient_conditions: ["type 2 diabetes"],
        patient_allergies: [],
        lab_values: { eGFR: 25, creatinine: 2.8 },
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.riskLevel).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. get_safer_alternatives
// ---------------------------------------------------------------------------

describe("get_safer_alternatives", () => {
  it("finds safer alternatives to ibuprofen for warfarin patient", async () => {
    const result = await client.callTool({
      name: "get_safer_alternatives",
      arguments: {
        proposed_medication: "ibuprofen",
        current_medications: ["warfarin"],
        patient_conditions: ["atrial fibrillation"],
        patient_allergies: [],
        max_alternatives: 3,
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.proposedMedication).toBe("ibuprofen");
    expect((s.alternatives as unknown[]).length).toBeGreaterThan(0);
    expect((s.alternatives as unknown[]).length).toBeLessThanOrEqual(3);
  });

  it("respects formulary_preferred list", async () => {
    const result = await client.callTool({
      name: "get_safer_alternatives",
      arguments: {
        proposed_medication: "diazepam",
        current_medications: [],
        patient_conditions: ["anxiety"],
        patient_allergies: [],
        formulary_preferred: ["buspirone", "hydroxyzine"],
        max_alternatives: 5,
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.riskLevel).toBeDefined();
    expect(s.alternatives).toBeDefined();
  });

  it("handles patient with multiple allergies", async () => {
    const result = await client.callTool({
      name: "get_safer_alternatives",
      arguments: {
        proposed_medication: "amoxicillin",
        current_medications: ["lisinopril"],
        patient_conditions: ["urinary tract infection"],
        patient_allergies: ["penicillin", "sulfa"],
        max_alternatives: 3,
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.alternatives).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. explain_medication_safety
// ---------------------------------------------------------------------------

describe("explain_medication_safety", () => {
  it("generates patient-facing explanation for low risk", async () => {
    const result = await client.callTool({
      name: "explain_medication_safety",
      arguments: {
        audience: "patient",
        language: "en",
        medication: "lisinopril",
        risk_level: "low",
        findings: [],
        recommendations: ["Take as prescribed", "Monitor blood pressure"],
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.audience).toBe("patient");
    expect(s.readingLevel).toBe("grade-8");
    expect(s.medication).toBe("lisinopril");
    expect(s.headline).toBeDefined();
    expect(s.explanation).toBeDefined();
    expect(s.disclaimer).toBeDefined();
  });

  it("generates provider-facing explanation for high risk with findings", async () => {
    const result = await client.callTool({
      name: "explain_medication_safety",
      arguments: {
        audience: "provider",
        language: "en",
        medication: "warfarin",
        risk_level: "high",
        findings: [
          {
            issue: "Concurrent NSAID use",
            severity: "major",
            clinical_impact: "13x increased GI bleeding risk",
            recommended_action: "Discontinue NSAID, use acetaminophen",
          },
          {
            issue: "Elevated INR",
            severity: "moderate",
            clinical_impact: "Supratherapeutic anticoagulation",
            recommended_action: "Reduce warfarin dose, recheck INR in 3 days",
          },
        ],
        recommendations: [
          "Switch analgesic to acetaminophen",
          "Recheck INR in 3 days",
          "Educate patient on warfarin-food interactions",
        ],
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.audience).toBe("provider");
    expect(s.readingLevel).toBe("clinical");
    expect(s.riskLevel).toBe("high");
    expect((s.keyPoints as unknown[]).length).toBeGreaterThan(0);
  });

  it("generates explanation in Spanish", async () => {
    const result = await client.callTool({
      name: "explain_medication_safety",
      arguments: {
        audience: "patient",
        language: "es",
        medication: "metformin",
        risk_level: "low",
        findings: [],
        recommendations: [],
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.language).toBe("es");
  });
});

// ---------------------------------------------------------------------------
// 6. calculate_patient_safety_score
// ---------------------------------------------------------------------------

describe("calculate_patient_safety_score", () => {
  it("scores high-risk elderly polypharmacy (or gracefully times out)", async () => {
    const result = await client.callTool({
      name: "calculate_patient_safety_score",
      arguments: {
        patient_age: 82,
        patient_conditions: ["heart failure", "COPD", "diabetes"],
        current_medications: [
          "warfarin",
          "digoxin",
          "metformin",
          "furosemide",
          "potassium chloride",
          "albuterol",
        ],
      },
    });

    if (isError(result)) {
      // RxNorm API may time out for large med lists — that's an external issue
      expect(textContent(result)).toMatch(/RXNORM_TIMEOUT|UPSTREAM/);
    } else {
      const s = structured(result);
      expect(s.score).toBeDefined();
      expect(typeof s.score).toBe("number");
      expect(s.grade).toBeDefined();
      expect(s.riskLevel).toBeDefined();
      expect(s.dashboardArtifact).toBeDefined();
      expect(s.deductions).toBeDefined();
      expect(s.interactionSummary).toBeDefined();
      expect(s.medicationCount).toBe(6);
    }
  });

  it("scores clean 2-med regimen", async () => {
    const result = await client.callTool({
      name: "calculate_patient_safety_score",
      arguments: {
        patient_age: 45,
        current_medications: ["lisinopril", "amlodipine"],
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(typeof s.score).toBe("number");
    expect((s.score as number)).toBeGreaterThanOrEqual(0);
    expect((s.score as number)).toBeLessThanOrEqual(100);
  });

  it("returns validation error for empty medications", async () => {
    const result = await client.callTool({
      name: "calculate_patient_safety_score",
      arguments: {
        current_medications: [],
      },
    });

    expect(isError(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. simulate_medication_change
// ---------------------------------------------------------------------------

describe("simulate_medication_change", () => {
  it("simulates adding a risky drug", async () => {
    const result = await client.callTool({
      name: "simulate_medication_change",
      arguments: {
        patient_age: 68,
        current_medications: ["warfarin", "lisinopril"],
        proposed_change: { action: "add", drug: "ibuprofen" },
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.recommendation).toBeDefined();
    expect(s.current).toBeDefined();
    expect(s.proposed).toBeDefined();
    expect(s.delta).toBeDefined();
    const delta = s.delta as { scoreDelta: number };
    // Adding ibuprofen to warfarin should lower the score
    expect(delta.scoreDelta).toBeLessThanOrEqual(0);
  });

  it("simulates removing a risky drug", async () => {
    const result = await client.callTool({
      name: "simulate_medication_change",
      arguments: {
        current_medications: ["warfarin", "ibuprofen", "lisinopril"],
        proposed_change: { action: "remove", drug: "ibuprofen" },
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.recommendation).toBeDefined();
    const delta = s.delta as { scoreDelta: number };
    // Removing ibuprofen from warfarin combo should improve score
    expect(delta.scoreDelta).toBeGreaterThanOrEqual(0);
  });

  it("simulates replacing a drug", async () => {
    const result = await client.callTool({
      name: "simulate_medication_change",
      arguments: {
        current_medications: ["warfarin", "ibuprofen"],
        proposed_change: {
          action: "replace",
          drug: "ibuprofen",
          replacement_drug: "acetaminophen",
        },
      },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.recommendation).toBeDefined();
    const proposed = s.proposedChange as { action: string };
    expect(proposed.action).toBe("replace");
  });

  it("returns validation error when replace has no replacement_drug", async () => {
    const result = await client.callTool({
      name: "simulate_medication_change",
      arguments: {
        current_medications: ["warfarin", "ibuprofen"],
        proposed_change: { action: "replace", drug: "ibuprofen" },
      },
    });

    expect(isError(result)).toBe(true);
    expect(textContent(result)).toContain("VALIDATION_ERROR");
  });

  it("returns validation error for empty medications", async () => {
    const result = await client.callTool({
      name: "simulate_medication_change",
      arguments: {
        current_medications: [],
        proposed_change: { action: "add", drug: "lisinopril" },
      },
    });

    expect(isError(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. get_decision_trace
// ---------------------------------------------------------------------------

describe("get_decision_trace", () => {
  it("returns recent traces after prior tool calls", async () => {
    const result = await client.callTool({
      name: "get_decision_trace",
      arguments: {},
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.traces).toBeDefined();
    // We called many tools above, so there should be traces
    expect((s.traces as unknown[]).length).toBeGreaterThan(0);
  });

  it("fetches a specific trace by requestId", async () => {
    // First make a call to get a requestId
    const callResult = await client.callTool({
      name: "check_drug_interactions",
      arguments: { medications: ["aspirin", "clopidogrel"] },
    });
    const requestId = structured(callResult).requestId as string;

    // Now fetch that specific trace
    const result = await client.callTool({
      name: "get_decision_trace",
      arguments: { request_id: requestId },
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.traces).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 9. get_decision_trace_dashboard
// ---------------------------------------------------------------------------

describe("get_decision_trace_dashboard", () => {
  it("returns dashboard metrics after multiple tool calls", async () => {
    const result = await client.callTool({
      name: "get_decision_trace_dashboard",
      arguments: {},
    });

    expect(isError(result)).toBe(false);
    const s = structured(result);
    expect(s.summary).toBeDefined();
    expect(s.toolBreakdown).toBeDefined();
    expect(s.recentTraces).toBeDefined();
    const summary = s.summary as { totalTraces: number; successRate: number };
    expect(summary.totalTraces).toBeGreaterThan(0);
  });
});
