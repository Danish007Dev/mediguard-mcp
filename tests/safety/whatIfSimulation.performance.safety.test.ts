import { Logger } from "../../src/logging/logger";
import { WhatIfSimulationService } from "../../src/services/whatIfSimulationService";

function percentile(values: number[], percentileRank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileRank * sorted.length) - 1);
  return sorted[index] ?? 0;
}

describe("Feature 3 performance baseline", () => {
  it("meets sub-2s p95 simulation latency with mocked scoring and interaction backends", async () => {
    const logger = new Logger("error", { test: true });

    const interactionService = {
      checkDrugInteractions: jest.fn().mockImplementation((medications: string[]) => {
        const interactions = medications.includes("aspirin")
          ? [
              {
                drugs: ["warfarin", "aspirin"],
                severity: "major" as const,
                mechanism: "Bleeding",
                clinicalImpact: "Major bleed risk",
                recommendations: ["Avoid overlap"],
                evidence: "label",
              },
            ]
          : [];

        return Promise.resolve({
          requestId: "11111111-1111-4111-8111-111111111111",
          source: "rxnorm-openfda" as const,
          analysisProvider: "rule-based" as const,
          riskLevel: interactions.length > 0 ? "high" as const : "low" as const,
          medications,
          patientContext: undefined,
          normalizedMedications: [],
          interactions,
          summary: "summary",
          analysisRecommendations: [],
          generatedAt: new Date().toISOString(),
        });
      }),
    };

    const patientSafetyScoreService = {
      calculateSafetyScore: jest.fn().mockImplementation((input: { currentMedications: string[] }) => {
        const withAspirin = input.currentMedications.includes("aspirin");

        return Promise.resolve({
          requestId: "22222222-2222-4222-8222-222222222222",
          source: "rules-interactions" as const,
          analysisProvider: "rule-based" as const,
          riskLevel: withAspirin ? "high" as const : "medium" as const,
          score: withAspirin ? 70 : 86,
          grade: withAspirin ? "C" as const : "B" as const,
          medicationCount: input.currentMedications.length,
          deductionTotal: withAspirin ? 30 : 14,
          deductions: [],
          interactionSummary: {
            contraindicated: 0,
            major: withAspirin ? 1 : 0,
            moderate: 0,
            minor: 0,
          },
          beersFlags: [],
          duplicateTherapeuticClasses: [],
          improvementOpportunities: [],
          potentialOptimizedScore: withAspirin ? 82 : 92,
          summary: "summary",
          generatedAt: new Date().toISOString(),
        });
      }),
    };

    const service = new WhatIfSimulationService(
      logger,
      interactionService as never,
      patientSafetyScoreService as never,
    );

    const durationsMs: number[] = [];
    const sampleCount = 120;

    for (let index = 0; index < sampleCount; index += 1) {
      const startedAt = Date.now();

      await service.simulate(
        {
          patientAge: 72,
          patientConditions: ["atrial fibrillation"],
          currentMedications: ["warfarin", "ibuprofen"],
          proposedChange: {
            action: "add",
            drug: "aspirin",
          },
        },
        `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`,
      );

      durationsMs.push(Date.now() - startedAt);
    }

    const p95 = percentile(durationsMs, 0.95);
    expect(p95).toBeLessThan(2000);
  });
});
