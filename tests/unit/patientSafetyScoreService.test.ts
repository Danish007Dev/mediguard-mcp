import { Logger } from "../../src/logging/logger";
import { PatientSafetyScoreService } from "../../src/services/patientSafetyScoreService";

describe("PatientSafetyScoreService", () => {
  const logger = new Logger("error", { test: true });

  it("calculates score deductions from interactions, polypharmacy, beers, and duplicates", async () => {
    const interactionService = {
      checkDrugInteractions: jest.fn().mockResolvedValue({
        requestId: "11111111-1111-4111-8111-111111111111",
        source: "rxnorm-openfda",
        analysisProvider: "rule-based",
        riskLevel: "high",
        medications: [
          "warfarin",
          "ibuprofen",
          "naproxen",
          "diazepam",
          "diphenhydramine",
          "lisinopril",
          "losartan",
          "med7",
          "med8",
          "med9",
          "med10",
          "med11",
        ],
        patientContext: undefined,
        normalizedMedications: [],
        interactions: [
          {
            drugs: ["warfarin", "ibuprofen"],
            severity: "major",
            mechanism: "Bleeding risk",
            clinicalImpact: "Major bleed",
            recommendations: ["Avoid routine NSAID use."],
            evidence: "label",
          },
          {
            drugs: ["warfarin", "naproxen"],
            severity: "moderate",
            mechanism: "Bleeding risk",
            clinicalImpact: "Moderate bleed",
            recommendations: ["Monitor closely."],
            evidence: "label",
          },
        ],
        summary: "summary",
        analysisRecommendations: ["rec"],
        generatedAt: new Date().toISOString(),
      }),
    };

    const service = new PatientSafetyScoreService(
      logger,
      interactionService as never,
    );

    const result = await service.calculateSafetyScore(
      {
        patientAge: 72,
        patientConditions: ["hypertension"],
        currentMedications: [
          "warfarin",
          "ibuprofen",
          "naproxen",
          "diazepam",
          "diphenhydramine",
          "lisinopril",
          "losartan",
          "med7",
          "med8",
          "med9",
          "med10",
          "med11",
        ],
      },
      "22222222-2222-4222-8222-222222222222",
    );

    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some((item) => item.category === "Drug interactions")).toBe(
      true,
    );
    expect(
      result.deductions.some((item) => item.category === "Polypharmacy burden"),
    ).toBe(true);
    expect(result.beersFlags.length).toBeGreaterThan(0);
    expect(result.duplicateTherapeuticClasses.length).toBeGreaterThan(0);
    expect(result.potentialOptimizedScore).toBeLessThanOrEqual(100);
  });

  it("throws validation error when no medications are provided", async () => {
    const interactionService = {
      checkDrugInteractions: jest.fn(),
    };

    const service = new PatientSafetyScoreService(
      logger,
      interactionService as never,
    );

    await expect(
      service.calculateSafetyScore(
        {
          patientAge: 40,
          patientConditions: [],
          currentMedications: [],
        },
        "33333333-3333-4333-8333-333333333333",
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
