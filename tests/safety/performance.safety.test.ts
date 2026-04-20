import { MockDrugInteractionService } from "../../src/services/mockDrugInteractionService";

function percentile(values: number[], percentileRank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileRank * sorted.length) - 1);
  return sorted[index] ?? 0;
}

describe("Phase 4 performance baseline", () => {
  it("meets sub-3s p95 latency for interaction checks under synthetic load", async () => {
    const service = new MockDrugInteractionService();
    const durationsMs: number[] = [];
    const sampleCount = 120;

    for (let index = 0; index < sampleCount; index += 1) {
      const startedAt = Date.now();

      await service.checkDrugInteractions(
        ["warfarin", "ibuprofen", "metformin"],
        `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
      );

      durationsMs.push(Date.now() - startedAt);
    }

    const p95 = percentile(durationsMs, 0.95);
    expect(p95).toBeLessThan(3000);
  });
});
