import { Logger } from "../../src/logging/logger";
import { WhatIfSimulationService } from "../../src/services/whatIfSimulationService";

function buildInteractionResult(params: {
  medications: string[];
  interactions: Array<{
    drugs: string[];
    severity: "minor" | "moderate" | "major" | "contraindicated";
    mechanism: string;
    clinicalImpact: string;
    recommendations: string[];
    evidence: string;
  }>;
}) {
  return {
    requestId: "11111111-1111-4111-8111-111111111111",
    source: "rxnorm-openfda" as const,
    analysisProvider: "rule-based" as const,
    riskLevel: "medium" as const,
    medications: params.medications,
    patientContext: undefined,
    normalizedMedications: [],
    interactions: params.interactions,
    summary: "summary",
    analysisRecommendations: [],
    generatedAt: new Date().toISOString(),
  };
}

function buildScoreResult(params: {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  riskLevel: "low" | "medium" | "high" | "critical";
  medicationCount: number;
}) {
  return {
    requestId: "22222222-2222-4222-8222-222222222222",
    source: "rules-interactions" as const,
    analysisProvider: "rule-based" as const,
    riskLevel: params.riskLevel,
    score: params.score,
    grade: params.grade,
    medicationCount: params.medicationCount,
    deductionTotal: Math.max(0, 100 - params.score),
    deductions: [],
    interactionSummary: {
      contraindicated: 0,
      major: 0,
      moderate: 0,
      minor: 0,
    },
    beersFlags: [],
    duplicateTherapeuticClasses: [],
    improvementOpportunities: [],
    potentialOptimizedScore: 100,
    summary: "score summary",
    generatedAt: new Date().toISOString(),
  };
}

describe("WhatIfSimulationService", () => {
  const logger = new Logger("error", { test: true });

  it("marks replacement as safer when score improves and risk is resolved", async () => {
    const interactionService = {
      checkDrugInteractions: jest.fn().mockImplementation((medications: string[]) => {
        if (medications.includes("acetaminophen")) {
          return Promise.resolve(
            buildInteractionResult({
              medications,
              interactions: [],
            }),
          );
        }

        return Promise.resolve(
          buildInteractionResult({
            medications,
            interactions: [
              {
                drugs: ["warfarin", "ibuprofen"],
                severity: "major",
                mechanism: "Bleeding",
                clinicalImpact: "Major bleed risk",
                recommendations: ["Avoid combination"],
                evidence: "label",
              },
            ],
          }),
        );
      }),
    };

    const patientSafetyScoreService = {
      calculateSafetyScore: jest.fn().mockImplementation((input: { currentMedications: string[] }) => {
        if (input.currentMedications.includes("acetaminophen")) {
          return Promise.resolve(
            buildScoreResult({
              score: 90,
              grade: "A",
              riskLevel: "low",
              medicationCount: input.currentMedications.length,
            }),
          );
        }

        return Promise.resolve(
          buildScoreResult({
            score: 75,
            grade: "B",
            riskLevel: "medium",
            medicationCount: input.currentMedications.length,
          }),
        );
      }),
    };

    const service = new WhatIfSimulationService(
      logger,
      interactionService as never,
      patientSafetyScoreService as never,
    );

    const result = await service.simulate(
      {
        patientAge: 70,
        patientConditions: ["atrial fibrillation"],
        currentMedications: ["warfarin", "ibuprofen"],
        proposedChange: {
          action: "replace",
          drug: "ibuprofen",
          replacementDrug: "acetaminophen",
        },
      },
      "33333333-3333-4333-8333-333333333333",
    );

    expect(result.recommendation).toBe("safer");
    expect(result.delta.scoreDelta).toBe(15);
    expect(result.resolvedRisks).toHaveLength(1);
    expect(result.newRisks).toHaveLength(0);
  });

  it("marks add scenario as riskier when score declines and new risk appears", async () => {
    const interactionService = {
      checkDrugInteractions: jest.fn().mockImplementation((medications: string[]) => {
        if (medications.includes("aspirin")) {
          return Promise.resolve(
            buildInteractionResult({
              medications,
              interactions: [
                {
                  drugs: ["warfarin", "aspirin"],
                  severity: "major",
                  mechanism: "Bleeding",
                  clinicalImpact: "Major bleed risk",
                  recommendations: ["Avoid overlap"],
                  evidence: "label",
                },
              ],
            }),
          );
        }

        return Promise.resolve(
          buildInteractionResult({
            medications,
            interactions: [],
          }),
        );
      }),
    };

    const patientSafetyScoreService = {
      calculateSafetyScore: jest.fn().mockImplementation((input: { currentMedications: string[] }) => {
        if (input.currentMedications.includes("aspirin")) {
          return Promise.resolve(
            buildScoreResult({
              score: 74,
              grade: "C",
              riskLevel: "high",
              medicationCount: input.currentMedications.length,
            }),
          );
        }

        return Promise.resolve(
          buildScoreResult({
            score: 92,
            grade: "A",
            riskLevel: "low",
            medicationCount: input.currentMedications.length,
          }),
        );
      }),
    };

    const service = new WhatIfSimulationService(
      logger,
      interactionService as never,
      patientSafetyScoreService as never,
    );

    const result = await service.simulate(
      {
        patientAge: 66,
        patientConditions: [],
        currentMedications: ["warfarin"],
        proposedChange: {
          action: "add",
          drug: "aspirin",
        },
      },
      "44444444-4444-4444-8444-444444444444",
    );

    expect(result.recommendation).toBe("riskier");
    expect(result.delta.scoreDelta).toBe(-18);
    expect(result.newRisks).toHaveLength(1);
    expect(result.resolvedRisks).toHaveLength(0);
  });

  it("throws validation error when replace action has no replacement drug", async () => {
    const interactionService = {
      checkDrugInteractions: jest.fn(),
    };

    const patientSafetyScoreService = {
      calculateSafetyScore: jest.fn(),
    };

    const service = new WhatIfSimulationService(
      logger,
      interactionService as never,
      patientSafetyScoreService as never,
    );

    await expect(
      service.simulate(
        {
          patientAge: 65,
          patientConditions: [],
          currentMedications: ["warfarin"],
          proposedChange: {
            action: "replace",
            drug: "warfarin",
          },
        },
        "55555555-5555-4555-8555-555555555555",
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
