import { DecisionTraceService } from "../../src/services/decisionTraceService";

function percentile(values: number[], percentileRank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileRank * sorted.length) - 1);
  return sorted[index] ?? 0;
}

describe("Feature 4 decision trace performance baseline", () => {
  it("retains bounded trace volume under high write load", () => {
    const service = new DecisionTraceService({
      maxRecords: 500,
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    const totalWrites = 5000;

    for (let index = 0; index < totalWrites; index += 1) {
      const requestId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`;

      service.startTrace({
        requestId,
        toolName: "check_drug_interactions",
        inputSummary: { medicationCount: 2 },
      });

      service.completeTrace({
        requestId,
        outputSummary: { riskLevel: "medium", interactionCount: 1 },
      });
    }

    const latest = service.listTraces({ limit: 1000 });
    expect(latest).toHaveLength(100);
    expect(
      service.getTrace("aaaaaaaa-aaaa-4aaa-8aaa-000000000000"),
    ).toBeUndefined();
    expect(
      service.getTrace("aaaaaaaa-aaaa-4aaa-8aaa-000000004999"),
    ).toBeDefined();
    expect(
      service.getTrace("aaaaaaaa-aaaa-4aaa-8aaa-000000004500"),
    ).toBeDefined();
  });

  it("meets sub-10ms p95 retrieval latency at 1000 retained traces", () => {
    const service = new DecisionTraceService({
      maxRecords: 1000,
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    for (let index = 0; index < 1000; index += 1) {
      const requestId = `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`;

      service.startTrace({
        requestId,
        toolName: index % 2 === 0 ? "check_drug_interactions" : "analyze_polypharmacy",
        inputSummary: { medicationCount: 3 },
      });

      service.completeTrace({
        requestId,
        outputSummary: { riskLevel: "low" },
      });
    }

    const durationsMs: number[] = [];

    for (let index = 0; index < 120; index += 1) {
      const startedAt = Date.now();
      service.listTraces({
        limit: 50,
        toolName: "check_drug_interactions",
      });
      durationsMs.push(Date.now() - startedAt);
    }

    const p95 = percentile(durationsMs, 0.95);
    expect(p95).toBeLessThan(10);
  });
});
