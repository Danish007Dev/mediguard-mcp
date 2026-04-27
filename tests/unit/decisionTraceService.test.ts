import { DecisionTraceService } from "../../src/services/decisionTraceService";

describe("DecisionTraceService", () => {
  it("stores and completes a trace with ordered steps", () => {
    const service = new DecisionTraceService();
    const requestId = "11111111-1111-4111-8111-111111111111";

    service.startTrace({
      requestId,
      toolName: "check_drug_interactions",
      inputSummary: { medicationCount: 2, hasSharpContext: false },
    });

    const startedAt = Date.now();
    service.addStep({
      requestId,
      name: "analysis",
      status: "success",
      startedAt,
      finishedAt: startedAt + 12,
      details: { interactionCount: 1 },
    });

    service.completeTrace({
      requestId,
      outputSummary: { riskLevel: "medium", interactionCount: 1 },
    });

    const trace = service.getTrace(requestId);

    expect(trace).toBeDefined();
    expect(trace?.status).toBe("success");
    expect(trace?.toolName).toBe("check_drug_interactions");
    expect(trace?.steps).toHaveLength(1);
    expect(trace?.steps[0]).toMatchObject({
      name: "analysis",
      status: "success",
      durationMs: 12,
    });
    expect(trace?.outputSummary).toMatchObject({
      riskLevel: "medium",
      interactionCount: 1,
    });
  });

  it("marks trace as error when failure is recorded", () => {
    const service = new DecisionTraceService();
    const requestId = "22222222-2222-4222-8222-222222222222";

    service.startTrace({
      requestId,
      toolName: "simulate_medication_change",
      inputSummary: { action: "replace" },
    });

    service.failTrace({
      requestId,
      code: "VALIDATION_ERROR",
      message: "replacement_drug is required",
    });

    const trace = service.getTrace(requestId);

    expect(trace).toBeDefined();
    expect(trace?.status).toBe("error");
    expect(trace?.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "replacement_drug is required",
    });
  });

  it("evicts oldest traces when retention cap is reached", () => {
    const service = new DecisionTraceService(2);

    service.startTrace({
      requestId: "33333333-3333-4333-8333-333333333333",
      toolName: "tool-a",
      inputSummary: {},
    });

    service.startTrace({
      requestId: "44444444-4444-4444-8444-444444444444",
      toolName: "tool-b",
      inputSummary: {},
    });

    service.startTrace({
      requestId: "55555555-5555-4555-8555-555555555555",
      toolName: "tool-c",
      inputSummary: {},
    });

    expect(
      service.getTrace("33333333-3333-4333-8333-333333333333"),
    ).toBeUndefined();
    expect(
      service.getTrace("44444444-4444-4444-8444-444444444444"),
    ).toBeDefined();
    expect(
      service.getTrace("55555555-5555-4555-8555-555555555555"),
    ).toBeDefined();
  });

  it("lists traces newest-first with filters", () => {
    const service = new DecisionTraceService();

    service.startTrace({
      requestId: "66666666-6666-4666-8666-666666666666",
      toolName: "analyze_polypharmacy",
      inputSummary: {},
    });

    service.startTrace({
      requestId: "77777777-7777-4777-8777-777777777777",
      toolName: "analyze_polypharmacy",
      inputSummary: {},
    });

    service.failTrace({
      requestId: "77777777-7777-4777-8777-777777777777",
      code: "INTERNAL_ERROR",
      message: "test",
    });

    const filtered = service.listTraces({
      toolName: "analyze_polypharmacy",
      status: "error",
      limit: 5,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].requestId).toBe("77777777-7777-4777-8777-777777777777");
  });
});
