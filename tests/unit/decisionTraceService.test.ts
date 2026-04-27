import { DecisionTraceService } from "../../src/services/decisionTraceService";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  it("redacts PHI-like fields in stored summaries and step details", () => {
    const service = new DecisionTraceService();
    const requestId = "88888888-8888-4888-8888-888888888888";

    service.startTrace({
      requestId,
      toolName: "check_drug_interactions",
      inputSummary: {
        patient_id: "patient-123",
        displayName: "Jane Doe",
        contact: "jane@example.com",
        medicationCount: 2,
      },
    });

    const startedAt = Date.now();
    service.addStep({
      requestId,
      name: "context_hydration",
      status: "success",
      startedAt,
      finishedAt: startedAt + 5,
      details: {
        auth_token: "secret-token",
        nursePhone: "555-123-4567",
      },
    });

    service.completeTrace({
      requestId,
      outputSummary: {
        riskLevel: "high",
        patientIdentifier: "abc-123",
      },
    });

    const trace = service.getTrace(requestId);

    expect(trace).toBeDefined();
    expect(trace?.inputSummary.patient_id).toBe("[REDACTED]");
    expect(trace?.inputSummary.displayName).toBe("[REDACTED]");
    expect(trace?.inputSummary.contact).toBe("[REDACTED]");
    expect(trace?.steps[0]?.details).toMatchObject({
      auth_token: "[REDACTED]",
      nursePhone: "[REDACTED]",
    });
    expect(trace?.outputSummary).toMatchObject({
      riskLevel: "high",
      patientIdentifier: "[REDACTED]",
    });
  });

  it("writes completed traces to archive path when configured", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mediguard-trace-"));
    const archivePath = join(tempDir, "decision-trace.ndjson");
    const service = new DecisionTraceService({ archivePath });
    const requestId = "99999999-9999-4999-8999-999999999999";

    service.startTrace({
      requestId,
      toolName: "simulate_medication_change",
      inputSummary: { action: "replace" },
    });

    service.completeTrace({
      requestId,
      outputSummary: { recommendation: "safer" },
    });

    const archived = readFileSync(archivePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { requestId: string });

    expect(archived).toHaveLength(1);
    expect(archived[0]?.requestId).toBe(requestId);
  });

  it("evicts traces older than configured maxAgeMs", () => {
    let fakeNow = 1_700_000_000_000;

    const service = new DecisionTraceService({
      maxAgeMs: 50,
      nowProvider: () => fakeNow,
    });

    const firstRequestId = "10101010-1010-4010-8010-101010101010";
    const secondRequestId = "20202020-2020-4020-8020-202020202020";

    service.startTrace({
      requestId: firstRequestId,
      toolName: "check_drug_interactions",
      inputSummary: {},
    });
    service.completeTrace({
      requestId: firstRequestId,
      outputSummary: { riskLevel: "medium" },
    });

    fakeNow += 60;

    service.startTrace({
      requestId: secondRequestId,
      toolName: "check_drug_interactions",
      inputSummary: {},
    });

    expect(service.getTrace(firstRequestId)).toBeUndefined();
    expect(service.getTrace(secondRequestId)).toBeDefined();
  });
});
