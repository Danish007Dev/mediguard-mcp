import { Logger } from "../../src/logging/logger";
import { DecisionTraceService } from "../../src/services/decisionTraceService";
import { executeGetDecisionTrace } from "../../src/tools/getDecisionTrace";

describe("get_decision_trace tool", () => {
  const logger = new Logger("error", { test: true });
  const requestId = "88888888-8888-4888-8888-888888888888";

  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns traces list with filters", async () => {
    const traceService = new DecisionTraceService();

    traceService.startTrace({
      requestId,
      toolName: "calculate_patient_safety_score",
      inputSummary: { medicationCount: 3 },
    });

    traceService.completeTrace({
      requestId,
      outputSummary: { score: 80, riskLevel: "medium" },
    });

    const response = await executeGetDecisionTrace(
      {
        tool_name: "calculate_patient_safety_score",
        status: "success",
        limit: 10,
      },
      {
        traceService,
        logger,
      },
    );

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toBeDefined();

    const structured = response.structuredContent as {
      traces: Array<{ requestId: string; toolName: string }>;
    };

    expect(structured.traces).toHaveLength(1);
    expect(structured.traces[0]).toMatchObject({
      requestId,
      toolName: "calculate_patient_safety_score",
    });
  });

  it("returns a single trace by request_id", async () => {
    const traceService = new DecisionTraceService();

    traceService.startTrace({
      requestId,
      toolName: "check_drug_interactions",
      inputSummary: { medicationCount: 2 },
    });

    const response = await executeGetDecisionTrace(
      {
        request_id: requestId,
        limit: 10,
      },
      {
        traceService,
        logger,
      },
    );

    expect(response.isError).not.toBe(true);

    const structured = response.structuredContent as {
      traces: Array<{ requestId: string }>;
    };

    expect(structured.traces).toHaveLength(1);
    expect(structured.traces[0].requestId).toBe(requestId);
  });

  it("returns MCP error when request_id is not found", async () => {
    const traceService = new DecisionTraceService();

    const response = await executeGetDecisionTrace(
      {
        request_id: "99999999-9999-4999-8999-999999999999",
        limit: 10,
      },
      {
        traceService,
        logger,
      },
    );

    expect(response.isError).toBe(true);
    expect(response.content?.[0]).toMatchObject({ type: "text" });
    expect((response.content?.[0] as { text: string }).text).toContain(
      "NOT_FOUND",
    );
  });
});
