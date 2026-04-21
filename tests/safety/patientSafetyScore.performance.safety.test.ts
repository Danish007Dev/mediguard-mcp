import { Logger } from "../../src/logging/logger";
import { PatientSafetyScoreService } from "../../src/services/patientSafetyScoreService";

function percentile(values: number[], percentileRank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileRank * sorted.length) - 1);
  return sorted[index] ?? 0;
}

describe("Feature 2 performance baseline", () => {
  it("meets sub-100ms p95 score calculation latency with mocked interaction backend", async () => {
    const logger = new Logger("error", { test: true });

    const interactionService = {
      checkDrugInteractions: jest.fn().mockResolvedValue({
        requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        source: "rxnorm-openfda",
        analysisProvider: "rule-based",
        riskLevel: "medium",
        medications: ["warfarin", "ibuprofen", "diazepam", "diphenhydramine"],
        patientContext: undefined,
        normalizedMedications: [],
        interactions: [
          {
            drugs: ["warfarin", "ibuprofen"],
            severity: "major",
            mechanism: "Bleeding",
            clinicalImpact: "Major risk",
            recommendations: ["Avoid chronic NSAID use"],
            evidence: "label",
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

    const durationsMs: number[] = [];
    const sampleCount = 120;

    for (let index = 0; index < sampleCount; index += 1) {
      const startedAt = Date.now();

      await service.calculateSafetyScore(
        {
          patientAge: 71,
          patientConditions: ["atrial fibrillation"],
          currentMedications: [
            "warfarin",
            "ibuprofen",
            "diazepam",
            "diphenhydramine",
          ],
        },
        `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, "0")}`,
      );

      durationsMs.push(Date.now() - startedAt);
    }

    const p95 = percentile(durationsMs, 0.95);
    expect(p95).toBeLessThan(100);
  });
});
