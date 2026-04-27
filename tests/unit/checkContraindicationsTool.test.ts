import { Logger } from "../../src/logging/logger";
import { executeCheckContraindications } from "../../src/tools/checkContraindications";
import { DecisionTraceService } from "../../src/services/decisionTraceService";

describe("check_contraindications tool", () => {
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

  it("returns structured contraindication result for valid input", async () => {
    const service = {
      checkContraindications: jest.fn().mockResolvedValue({
        requestId: "33333333-3333-4333-8333-333333333333",
        source: "rules-dailymed",
        analysisProvider: "rule-based",
        riskLevel: "medium",
        contraindicated: false,
        proposedMedication: "metformin",
        contraindications: [],
        summary: "Summary",
        analysisRecommendations: ["Recommendation"],
        labelEvidence: {
          contraindications: [],
          warnings: [],
          pregnancy: [],
          renal: [],
          hepatic: [],
        },
        generatedAt: new Date().toISOString(),
      }),
    };

    const result = await executeCheckContraindications(
      {
        proposed_medication: "metformin",
        patient_allergies: [],
        patient_conditions: ["type 2 diabetes"],
        lab_values: {
          egfr: 52,
        },
      },
      {
        service,
        logger,
      },
    );

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toBeDefined();
  });

  it("returns error response when service throws", async () => {
    const service = {
      checkContraindications: jest
        .fn()
        .mockRejectedValue(new Error("contraindication failure")),
    };

    const result = await executeCheckContraindications(
      {
        proposed_medication: "metformin",
        patient_allergies: [],
        patient_conditions: [],
      },
      {
        service,
        logger,
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]).toMatchObject({ type: "text" });
  });

  it("writes a decision trace for successful contraindication checks", async () => {
    const service = {
      checkContraindications: jest.fn().mockResolvedValue({
        requestId: "11111111-1111-4111-8111-111111111111",
        source: "rules-dailymed",
        analysisProvider: "rule-based",
        riskLevel: "medium",
        contraindicated: false,
        proposedMedication: "metformin",
        contraindications: [],
        summary: "Summary",
        analysisRecommendations: ["Recommendation"],
        labelEvidence: {
          contraindications: [],
          warnings: [],
          pregnancy: [],
          renal: [],
          hepatic: [],
        },
        generatedAt: new Date().toISOString(),
      }),
    };

    const traceService = new DecisionTraceService();

    const response = await executeCheckContraindications(
      {
        proposed_medication: "metformin",
        patient_allergies: [],
        patient_conditions: [],
      },
      {
        service,
        logger,
        traceService,
      },
    );

    expect(response.isError).not.toBe(true);

    const structured = response.structuredContent as {
      riskLevel: string;
    };

    const traces = traceService.listTraces({
      toolName: "check_contraindications",
      limit: 1,
    });
    const trace = traces[0];
    expect(trace).toBeDefined();
    expect(trace?.toolName).toBe("check_contraindications");
    expect(trace?.status).toBe("success");
    expect(trace?.steps.length).toBeGreaterThan(0);
    expect(trace?.outputSummary).toMatchObject({
      riskLevel: structured.riskLevel,
    });
  });
});
