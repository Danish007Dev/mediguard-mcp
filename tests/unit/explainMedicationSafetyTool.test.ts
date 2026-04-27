import { Logger } from "../../src/logging/logger";
import { DecisionTraceService } from "../../src/services/decisionTraceService";
import { executeExplainMedicationSafety } from "../../src/tools/explainMedicationSafety";

describe("explain_medication_safety tool", () => {
  const logger = new Logger("error", { test: true });

  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns structured explanation result for valid input", async () => {
    const service = {
      explainMedicationSafety: jest.fn().mockResolvedValue({
        requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        source: "template-llm",
        analysisProvider: "rule-based",
        audience: "patient",
        language: "en",
        readingLevel: "grade-8",
        medication: "ibuprofen",
        riskLevel: "high",
        headline: "Safety summary for ibuprofen",
        explanation: "This medicine may increase bleeding risk in your case.",
        keyPoints: ["Key point"],
        followUpQuestions: ["Question"],
        disclaimer: "Educational output only.",
        generatedAt: new Date().toISOString(),
      }),
    };

    const result = await executeExplainMedicationSafety(
      {
        audience: "patient",
        language: "en",
        medication: "ibuprofen",
        risk_level: "high",
        findings: [
          {
            issue: "Anticoagulant interaction",
            severity: "major",
            clinical_impact: "Increased bleeding risk",
            recommended_action: "Avoid combination",
          },
        ],
        recommendations: ["Use acetaminophen"],
      },
      {
        service,
        logger,
      },
    );

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toBeDefined();
  });

  it("returns error response when service throws", async () => {
    const service = {
      explainMedicationSafety: jest
        .fn()
        .mockRejectedValue(new Error("explanation failure")),
    };

    const result = await executeExplainMedicationSafety(
      {
        audience: "provider",
        language: "en",
        medication: "metformin",
        risk_level: "medium",
        findings: [],
        recommendations: [],
      },
      {
        service,
        logger,
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]).toMatchObject({ type: "text" });
  });

  it("writes a decision trace for successful explanation generation", async () => {
    const service = {
      explainMedicationSafety: jest.fn().mockResolvedValue({
        requestId: "13131313-1313-4313-8313-131313131313",
        source: "template-llm",
        analysisProvider: "rule-based",
        audience: "patient",
        language: "en",
        readingLevel: "grade-8",
        medication: "ibuprofen",
        riskLevel: "high",
        headline: "Safety summary for ibuprofen",
        explanation: "This medicine may increase bleeding risk in your case.",
        keyPoints: ["Key point"],
        followUpQuestions: ["Question"],
        disclaimer: "Educational output only.",
        generatedAt: new Date().toISOString(),
      }),
    };

    const traceService = new DecisionTraceService();

    const response = await executeExplainMedicationSafety(
      {
        audience: "patient",
        language: "en",
        medication: "ibuprofen",
        risk_level: "high",
        findings: [],
        recommendations: [],
      },
      {
        service,
        logger,
        traceService,
      },
    );

    expect(response.isError).not.toBe(true);

    const structured = response.structuredContent as {
      riskLevel: string;
    };

    const traces = traceService.listTraces({
      toolName: "explain_medication_safety",
      limit: 1,
    });
    const trace = traces[0];
    expect(trace).toBeDefined();
    expect(trace?.toolName).toBe("explain_medication_safety");
    expect(trace?.status).toBe("success");
    expect(trace?.steps.length).toBeGreaterThan(0);
    expect(trace?.outputSummary).toMatchObject({
      riskLevel: structured.riskLevel,
    });
  });
});
