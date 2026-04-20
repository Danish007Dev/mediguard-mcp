import { executeCheckDrugInteractions } from "../../src/tools/checkDrugInteractions";
import { Logger } from "../../src/logging/logger";
import { MockDrugInteractionService } from "../../src/services/mockDrugInteractionService";

describe("check_drug_interactions tool", () => {
  const logger = new Logger("error", { test: true });
  const service = new MockDrugInteractionService();
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns structured content for valid medication input", async () => {
    const response = await executeCheckDrugInteractions(
      { medications: ["warfarin", "ibuprofen"] },
      { logger, service },
    );

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toBeDefined();
  });

  it("returns MCP error result when validation fails in service", async () => {
    const response = await executeCheckDrugInteractions(
      { medications: ["warfarin"] },
      { logger, service },
    );

    expect(response.isError).toBe(true);
    expect(response.content?.[0]).toMatchObject({ type: "text" });
  });

  it("hydrates medications from sharp_context when explicit medications are missing", async () => {
    const sharpContextService = {
      resolveMedications: jest
        .fn()
        .mockResolvedValue(["warfarin", "ibuprofen"]),
      resolveAllergies: jest.fn(),
      resolveConditions: jest.fn(),
      propagateContext: jest.fn(),
    };

    const response = await executeCheckDrugInteractions(
      {
        medications: [],
        sharp_context: {
          patient_id: "patient-123",
          fhir_endpoint: "https://fhir.example.com",
          auth_token: "token-123",
        },
      },
      { logger, service, sharpContextService },
    );

    expect(response.isError).not.toBe(true);
    expect(sharpContextService.resolveMedications).toHaveBeenCalledTimes(1);
    expect(sharpContextService.propagateContext).toHaveBeenCalledTimes(1);
  });
});
