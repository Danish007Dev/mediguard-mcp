import { Logger } from "../../src/logging/logger";
import { executeCalculatePatientSafetyScore } from "../../src/tools/calculatePatientSafetyScore";

describe("calculate_patient_safety_score tool", () => {
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

  it("returns structured score result for valid input", async () => {
    const service = {
      calculateSafetyScore: jest.fn().mockResolvedValue({
        requestId: "44444444-4444-4444-8444-444444444444",
        source: "rules-interactions",
        analysisProvider: "rule-based",
        riskLevel: "medium",
        score: 82,
        grade: "B",
        medicationCount: 5,
        deductionTotal: 18,
        deductions: [
          {
            category: "Drug interactions",
            points: 15,
            rationale: "Major interaction detected.",
          },
        ],
        interactionSummary: {
          contraindicated: 0,
          major: 1,
          moderate: 0,
          minor: 0,
        },
        beersFlags: [],
        duplicateTherapeuticClasses: [],
        improvementOpportunities: [
          {
            title: "Mitigate high-severity interactions",
            action: "Switch NSAID to safer alternative.",
            expectedPointsGain: 15,
          },
        ],
        potentialOptimizedScore: 97,
        summary: "Patient safety score summary",
        generatedAt: new Date().toISOString(),
      }),
    };

    const response = await executeCalculatePatientSafetyScore(
      {
        patient_age: 70,
        patient_conditions: ["hypertension"],
        current_medications: ["warfarin", "ibuprofen"],
      },
      {
        service,
        logger,
      },
    );

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toBeDefined();
  });

  it("returns error response when score service throws", async () => {
    const service = {
      calculateSafetyScore: jest
        .fn()
        .mockRejectedValue(new Error("score failure")),
    };

    const response = await executeCalculatePatientSafetyScore(
      {
        patient_age: 70,
        patient_conditions: ["hypertension"],
        current_medications: ["warfarin"],
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
