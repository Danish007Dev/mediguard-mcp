import { Logger } from "../../src/logging/logger";
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
});
