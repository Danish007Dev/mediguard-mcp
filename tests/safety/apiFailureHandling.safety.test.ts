import { OpenFdaClient } from "../../src/clients/openFdaClient";
import { FhirR4Client } from "../../src/clients/fhirR4Client";
import { Logger } from "../../src/logging/logger";
import { executeCheckDrugInteractions } from "../../src/tools/checkDrugInteractions";
import { MockDrugInteractionService } from "../../src/services/mockDrugInteractionService";

describe("Phase 4 API failure handling", () => {
  const logger = new Logger("error", { test: true });
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    consoleErrorSpy.mockRestore();
  });

  it("maps OpenFDA 5xx responses into OPENFDA_API_ERROR", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("server unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    const client = new OpenFdaClient({
      baseUrl: "https://api.fda.gov",
      timeoutMs: 1_000,
      cacheTtlMs: 0,
      logger,
    });

    await expect(
      client.getDrugLabelInteractions("warfarin"),
    ).rejects.toMatchObject({
      code: "OPENFDA_API_ERROR",
    });
  });

  it("maps FHIR 5xx responses into FHIR_API_ERROR", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("upstream failed", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );

    const client = new FhirR4Client({
      timeoutMs: 1_000,
      pageSize: 25,
      maxPages: 2,
      logger,
    });

    await expect(
      client.fetchPatientMedications(
        "patient-1",
        "https://fhir.example.com",
        "token-123",
      ),
    ).rejects.toMatchObject({
      code: "FHIR_API_ERROR",
    });
  });

  it("returns MCP error payload when SHARP hydration fails", async () => {
    const response = await executeCheckDrugInteractions(
      {
        medications: [],
        sharp_context: {
          patient_id: "patient-123",
          fhir_endpoint: "https://fhir.example.com",
          auth_token: "token-123",
        },
      },
      {
        logger,
        service: new MockDrugInteractionService(),
        sharpContextService: {
          resolveMedications: jest
            .fn()
            .mockRejectedValue(new Error("FHIR data source unavailable")),
          resolveAllergies: jest.fn(),
          resolveConditions: jest.fn(),
          propagateContext: jest.fn(),
        },
      },
    );

    expect(response.isError).toBe(true);
    expect(response.content?.[0]).toMatchObject({
      type: "text",
    });
    expect((response.content?.[0] as { text?: string }).text).toContain(
      "FHIR data source unavailable",
    );
  });
});
