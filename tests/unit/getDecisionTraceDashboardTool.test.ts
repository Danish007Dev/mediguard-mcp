import { Logger } from "../../src/logging/logger";
import { DecisionTraceService } from "../../src/services/decisionTraceService";
import { executeGetDecisionTraceDashboard } from "../../src/tools/getDecisionTraceDashboard";

describe("get_decision_trace_dashboard tool", () => {
  const logger = new Logger("error", { test: true });

  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns aggregated dashboard metrics", async () => {
    const traceService = new DecisionTraceService();

    traceService.startTrace({
      requestId: "60606060-6060-4060-8060-606060606060",
      toolName: "simulate_medication_change",
      inputSummary: { action: "replace" },
    });
    traceService.completeTrace({
      requestId: "60606060-6060-4060-8060-606060606060",
      outputSummary: { recommendation: "safer" },
    });

    const response = await executeGetDecisionTraceDashboard(
      {
        tool_name: "simulate_medication_change",
        window_minutes: 60,
        limit: 5,
      },
      {
        traceService,
        logger,
      },
    );

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toBeDefined();

    const structured = response.structuredContent as {
      summary: { totalTraces: number; successCount: number };
      toolBreakdown: Array<{ toolName: string }>;
      recentTraces: Array<{ requestId: string }>;
    };

    expect(structured.summary.totalTraces).toBe(1);
    expect(structured.summary.successCount).toBe(1);
    expect(structured.toolBreakdown[0]?.toolName).toBe(
      "simulate_medication_change",
    );
    expect(structured.recentTraces[0]?.requestId).toBe(
      "60606060-6060-4060-8060-606060606060",
    );
  });

  it("returns MCP error on invalid args", async () => {
    const traceService = new DecisionTraceService();

    const response = await executeGetDecisionTraceDashboard(
      {
        window_minutes: 0,
        limit: 5,
      },
      {
        traceService,
        logger,
      },
    );

    expect(response.isError).toBe(true);
    expect(response.content?.[0]).toMatchObject({ type: "text" });
  });
});
