import { Logger } from "../../src/logging/logger";
import { executeGetSaferAlternatives } from "../../src/tools/getSaferAlternatives";

describe("get_safer_alternatives tool", () => {
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

  it("returns structured safer-alternative result for valid input", async () => {
    const service = {
      getSaferAlternatives: jest.fn().mockResolvedValue({
        requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        source: "rules-formulary-llm",
        analysisProvider: "rule-based",
        riskLevel: "high",
        proposedMedication: "ibuprofen",
        riskContext: [
          "Current anticoagulant use increases major bleeding risk with NSAID therapy.",
        ],
        alternatives: [
          {
            medication: "acetaminophen",
            therapeuticClass: "Non-opioid analgesic",
            safetyScore: 92,
            formularyPreferred: true,
            avoidsRisks: [
              "Current anticoagulant use increases major bleeding risk with NSAID therapy.",
            ],
            cautionFlags: [],
            rationale: "Safer option",
          },
        ],
        summary: "Summary",
        analysisRecommendations: ["Recommendation"],
        generatedAt: new Date().toISOString(),
      }),
    };

    const result = await executeGetSaferAlternatives(
      {
        proposed_medication: "ibuprofen",
        current_medications: ["warfarin"],
        patient_allergies: [],
        patient_conditions: [],
        formulary_preferred: ["acetaminophen"],
        max_alternatives: 3,
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
      getSaferAlternatives: jest
        .fn()
        .mockRejectedValue(new Error("ranking failure")),
    };

    const result = await executeGetSaferAlternatives(
      {
        proposed_medication: "ibuprofen",
        current_medications: [],
        patient_allergies: [],
        patient_conditions: [],
        formulary_preferred: [],
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
