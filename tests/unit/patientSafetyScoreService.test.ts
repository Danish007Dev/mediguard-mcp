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

  it("computes deterministic score and grade from configured deductions", async () => {
    const interactionService = {
      checkDrugInteractions: jest.fn().mockResolvedValue({
        requestId: "55555555-5555-4555-8555-555555555555",
        source: "rxnorm-openfda",
        analysisProvider: "rule-based",
        riskLevel: "high",
        medications: ["warfarin", "ibuprofen", "diphenhydramine"],
        patientContext: undefined,
        normalizedMedications: [],
        interactions: [
          {
            drugs: ["warfarin", "ibuprofen"],
            severity: "major",
            mechanism: "Bleeding",
            clinicalImpact: "Major bleeding risk",
            recommendations: ["Use safer analgesic."],
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
        patientAge: 70,
        patientConditions: [],
        currentMedications: ["warfarin", "ibuprofen", "diphenhydramine"],
      },
      "66666666-6666-4666-8666-666666666666",
    );

    // 100 - (major=15) - (Beers=10) = 75 => grade B
    expect(result.score).toBe(75);
    expect(result.grade).toBe("B");
    expect(result.deductionTotal).toBe(25);
    expect(result.riskLevel).toBe("medium");
  });

  it("does not count duplicate medication names multiple times", async () => {
    const interactionService = {
      checkDrugInteractions: jest.fn().mockResolvedValue({
        requestId: "77777777-7777-4777-8777-777777777777",
        source: "rxnorm-openfda",
        analysisProvider: "rule-based",
        riskLevel: "low",
        medications: ["ibuprofen"],
        patientContext: undefined,
        normalizedMedications: [],
        interactions: [],
        summary: "summary",
        analysisRecommendations: [],
        generatedAt: new Date().toISOString(),
      }),
    };

    const service = new PatientSafetyScoreService(
      logger,
      interactionService as never,
    );

    const result = await service.calculateSafetyScore(
      {
        patientAge: 40,
        patientConditions: [],
        currentMedications: ["Ibuprofen", " ibuprofen ", "IBUPROFEN"],
      },
      "88888888-8888-4888-8888-888888888888",
    );

    expect(result.medicationCount).toBe(1);
    expect(interactionService.checkDrugInteractions).toHaveBeenCalledWith(
      ["Ibuprofen"],
      "88888888-8888-4888-8888-888888888888",
      expect.any(Object),
    );
  });

  it("supports 30+ medication edge-case input", async () => {
    const currentMedications = Array.from(
      { length: 32 },
      (_, index) => `med-${index + 1}`,
    );

    const interactionService = {
      checkDrugInteractions: jest.fn().mockResolvedValue({
        requestId: "99999999-9999-4999-8999-999999999999",
        source: "rxnorm-openfda",
        analysisProvider: "rule-based",
        riskLevel: "medium",
        medications: currentMedications,
        patientContext: undefined,
        normalizedMedications: [],
        interactions: [],
        summary: "summary",
        analysisRecommendations: [],
        generatedAt: new Date().toISOString(),
      }),
    };

    const service = new PatientSafetyScoreService(
      logger,
      interactionService as never,
    );

    const result = await service.calculateSafetyScore(
      {
        patientAge: 60,
        patientConditions: [],
        currentMedications,
      },
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.medicationCount).toBe(32);
    expect(result.deductions.some((item) => item.category === "Polypharmacy burden")).toBe(true);
  });

  it("caps potential optimized score at 100", async () => {
    const interactionService = {
      checkDrugInteractions: jest.fn().mockResolvedValue({
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        source: "rxnorm-openfda",
        analysisProvider: "rule-based",
        riskLevel: "high",
        medications: ["diazepam"],
        patientContext: undefined,
        normalizedMedications: [],
        interactions: [
          {
            drugs: ["diazepam", "diazepam-helper"],
            severity: "moderate",
            mechanism: "Sedation",
            clinicalImpact: "Moderate risk",
            recommendations: ["Reduce sedatives."],
            evidence: "rule",
          },
        ],
        summary: "summary",
        analysisRecommendations: [],
        generatedAt: new Date().toISOString(),
      }),
    };

    const service = new PatientSafetyScoreService(
      logger,
      interactionService as never,
    );

    const result = await service.calculateSafetyScore(
      {
        patientAge: 70,
        patientConditions: [],
        currentMedications: ["diazepam"],
      },
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );

    expect(result.potentialOptimizedScore).toBeLessThanOrEqual(100);
  });

});
