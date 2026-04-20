import { Logger } from "../../src/logging/logger";
import { executeAnalyzePolypharmacy } from "../../src/tools/analyzePolypharmacy";

describe("analyze_polypharmacy tool", () => {
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

  it("returns structured polypharmacy analysis for valid input", async () => {
    const service = {
      analyzePolypharmacy: jest.fn().mockResolvedValue({
        requestId: "77777777-7777-4777-8777-777777777777",
        source: "rules-llm",
        analysisProvider: "rule-based",
        riskLevel: "medium",
        isElderly: true,
        medicationCount: 5,
        beersFlags: [],
        duplicateTherapeuticClasses: [],
        drugBurdenIndex: 0.4,
        deprescribingOpportunities: [],
        summary: "Polypharmacy summary",
        analysisRecommendations: ["Recommendation 1"],
        generatedAt: new Date().toISOString(),
      }),
    };

    const response = await executeAnalyzePolypharmacy(
      {
        patient_age: 68,
        patient_conditions: ["hypertension"],
        current_medications: ["amlodipine", "lisinopril"],
      },
      {
        service,
        logger,
      },
    );

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toBeDefined();
  });

  it("returns error response when analysis service throws", async () => {
    const service = {
      analyzePolypharmacy: jest
        .fn()
        .mockRejectedValue(new Error("polypharmacy failure")),
    };

    const response = await executeAnalyzePolypharmacy(
      {
        patient_age: 68,
        patient_conditions: ["hypertension"],
        current_medications: ["amlodipine"],
      },
      {
        service,
        logger,
      },
    );

    expect(response.isError).toBe(true);
    expect(response.content?.[0]).toMatchObject({ type: "text" });
  });
});
