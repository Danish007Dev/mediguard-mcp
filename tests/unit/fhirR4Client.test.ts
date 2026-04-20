import { Logger } from "../../src/logging/logger";
import { FhirR4Client } from "../../src/clients/fhirR4Client";

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("FhirR4Client", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fetches paginated MedicationRequest resources", async () => {
    const logger = new Logger("error", { test: true });
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "MedicationRequest",
                status: "active",
                medicationCodeableConcept: { text: "warfarin" },
              },
            },
          ],
          link: [
            {
              relation: "next",
              url: "https://fhir.example.com/MedicationRequest?page=2",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "MedicationRequest",
                status: "active",
                medicationCodeableConcept: { text: "ibuprofen" },
              },
            },
          ],
        }),
      );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    const result = await client.fetchPatientMedications(
      "patient-1",
      "https://fhir.example.com",
      "token-123",
    );

    expect(result).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refreshes OAuth token after unauthorized FHIR response", async () => {
    const logger = new Logger("error", { test: true });
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "MedicationRequest",
                status: "active",
                medicationCodeableConcept: { text: "metformin" },
              },
            },
          ],
        }),
      );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    const result = await client.fetchPatientMedications(
      "patient-2",
      "https://fhir.example.com",
      {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        clientId: "client-id",
        clientSecret: "client-secret",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      },
    );

    expect(result).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const refreshCall = fetchSpy.mock.calls[1];
    expect(refreshCall?.[0]).toBe("https://auth.example.com/oauth/token");
  });

  it("filters conditions to active/recurrence/relapse statuses", async () => {
    const logger = new Logger("error", { test: true });
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Condition",
              clinicalStatus: {
                coding: [{ code: "active" }],
              },
              code: { text: "Heart failure" },
            },
          },
          {
            resource: {
              resourceType: "Condition",
              clinicalStatus: {
                coding: [{ code: "resolved" }],
              },
              code: { text: "Resolved infection" },
            },
          },
        ],
      }),
    );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    const result = await client.fetchPatientConditions(
      "patient-3",
      "https://fhir.example.com",
      "token-abc",
    );

    expect(result).toHaveLength(1);
  });

  it("resolves relative next links against the endpoint URL", async () => {
    const logger = new Logger("error", { test: true });
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "MedicationRequest",
                status: "active",
              },
            },
          ],
          link: [
            {
              relation: "next",
              url: "/MedicationRequest?page=2",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "MedicationRequest",
                status: "active",
              },
            },
          ],
        }),
      );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    const result = await client.fetchPatientMedications(
      "patient-4",
      "https://fhir.example.com/base",
      "token-xyz",
    );

    expect(result).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      "https://fhir.example.com/MedicationRequest?page=2",
    );
  });

  it("logs warning and stops pagination at maxPages", async () => {
    const logger = new Logger("error", { test: true });
    const warnSpy = jest.spyOn(logger, "warn");
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "MedicationRequest",
              status: "active",
            },
          },
        ],
        link: [
          {
            relation: "next",
            url: "https://fhir.example.com/MedicationRequest?page=2",
          },
        ],
      }),
    );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 1,
      logger,
    });

    const result = await client.fetchPatientMedications(
      "patient-5",
      "https://fhir.example.com",
      "token-xyz",
    );

    expect(result).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "FHIR pagination stopped at max page limit",
      expect.any(Object),
    );
  });

  it("throws FHIR_API_ERROR for unauthorized responses when refresh is not possible", async () => {
    const logger = new Logger("error", { test: true });
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 401 }));

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    await expect(
      client.fetchPatientMedications(
        "patient-6",
        "https://fhir.example.com",
        "token-unauthorized",
      ),
    ).rejects.toMatchObject({
      code: "FHIR_API_ERROR",
    });
  });

  it("refreshes expired token before first FHIR request using default token endpoint", async () => {
    const logger = new Logger("error", { test: true });
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: "fresh-token",
          refresh_token: "fresh-refresh",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "MedicationRequest",
                status: "active",
              },
            },
          ],
        }),
      );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      defaultTokenEndpoint: "https://auth.example.com/token",
      logger,
    });

    const result = await client.fetchPatientMedications(
      "patient-7",
      "https://fhir.example.com",
      {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 120_000).toISOString(),
        tokenType: "Bearer",
      },
    );

    expect(result).toHaveLength(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://auth.example.com/token");
    const requestOptions = fetchSpy.mock.calls[1]?.[1] as {
      headers?: Record<string, string>;
    };
    expect(requestOptions?.headers?.Authorization).toBe("Bearer fresh-token");
  });

  it("throws refresh error when token is expired and refresh token is missing", async () => {
    const logger = new Logger("error", { test: true });

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    await expect(
      client.fetchPatientMedications("patient-8", "https://fhir.example.com", {
        accessToken: "expired-token",
        expiresAt: new Date(Date.now() - 120_000).toISOString(),
        tokenType: "Bearer",
      }),
    ).rejects.toMatchObject({
      code: "FHIR_AUTH_REFRESH_ERROR",
    });
  });

  it("throws refresh error when token endpoint is not configured", async () => {
    const logger = new Logger("error", { test: true });

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    await expect(
      client.fetchPatientMedications("patient-9", "https://fhir.example.com", {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 120_000).toISOString(),
        tokenType: "Bearer",
      }),
    ).rejects.toMatchObject({
      code: "FHIR_AUTH_REFRESH_ERROR",
    });
  });

  it("maps refresh AbortError to FHIR_AUTH_REFRESH_ERROR", async () => {
    const logger = new Logger("error", { test: true });
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      defaultTokenEndpoint: "https://auth.example.com/token",
      logger,
    });

    await expect(
      client.fetchPatientMedications("patient-10", "https://fhir.example.com", {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 120_000).toISOString(),
        tokenType: "Bearer",
      }),
    ).rejects.toMatchObject({
      code: "FHIR_AUTH_REFRESH_ERROR",
    });
  });

  it("maps request AbortError to FHIR_TIMEOUT", async () => {
    const logger = new Logger("error", { test: true });
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    await expect(
      client.fetchPatientMedications(
        "patient-11",
        "https://fhir.example.com",
        "token-abc",
      ),
    ).rejects.toMatchObject({
      code: "FHIR_TIMEOUT",
    });
  });

  it("maps generic request exceptions to FHIR_API_ERROR", async () => {
    const logger = new Logger("error", { test: true });
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"));

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    await expect(
      client.fetchPatientMedications(
        "patient-12",
        "https://fhir.example.com",
        "token-abc",
      ),
    ).rejects.toMatchObject({
      code: "FHIR_API_ERROR",
    });
  });

  it("throws FHIR_PARSE_ERROR when FHIR response body is invalid JSON", async () => {
    const logger = new Logger("error", { test: true });
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    await expect(
      client.fetchPatientMedications(
        "patient-13",
        "https://fhir.example.com",
        "token-abc",
      ),
    ).rejects.toMatchObject({
      code: "FHIR_PARSE_ERROR",
    });
  });

  it("accepts condition entries without coding and includes them by default", async () => {
    const logger = new Logger("error", { test: true });
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Condition",
              code: { text: "Problem with missing coding" },
            },
          },
        ],
      }),
    );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    const result = await client.fetchPatientConditions(
      "patient-14",
      "https://fhir.example.com",
      "token-abc",
    );
    expect(result).toHaveLength(1);
  });

  it("treats missing expiresAt as non-expired token and skips refresh", async () => {
    const logger = new Logger("error", { test: true });
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        resourceType: "Bundle",
        entry: [],
      }),
    );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      defaultTokenEndpoint: "https://auth.example.com/token",
      logger,
    });

    await client.fetchPatientMedications(
      "patient-15",
      "https://fhir.example.com",
      {
        accessToken: "token-no-expiry",
        refreshToken: "refresh-token",
        tokenType: "Bearer",
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("/MedicationRequest");
  });

  it("treats invalid expiresAt string as non-expired token", async () => {
    const logger = new Logger("error", { test: true });
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        resourceType: "Bundle",
        entry: [],
      }),
    );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      defaultTokenEndpoint: "https://auth.example.com/token",
      logger,
    });

    await client.fetchPatientMedications(
      "patient-16",
      "https://fhir.example.com",
      {
        accessToken: "token-invalid-expiry",
        refreshToken: "refresh-token",
        expiresAt: "not-a-date",
        tokenType: "Bearer",
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws refresh error when OAuth endpoint returns non-OK status", async () => {
    const logger = new Logger("error", { test: true });
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 500 }));

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      defaultTokenEndpoint: "https://auth.example.com/token",
      logger,
    });

    await expect(
      client.fetchPatientMedications("patient-17", "https://fhir.example.com", {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        tokenType: "Bearer",
      }),
    ).rejects.toMatchObject({
      code: "FHIR_AUTH_REFRESH_ERROR",
    });
  });

  it("throws refresh error when refresh payload omits access_token", async () => {
    const logger = new Logger("error", { test: true });
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        refresh_token: "still-here",
        expires_in: 3600,
      }),
    );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      defaultTokenEndpoint: "https://auth.example.com/token",
      logger,
    });

    await expect(
      client.fetchPatientMedications("patient-18", "https://fhir.example.com", {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        tokenType: "Bearer",
      }),
    ).rejects.toMatchObject({
      code: "FHIR_AUTH_REFRESH_ERROR",
    });
  });

  it("handles refresh with generic network error using refresh-error wrapper", async () => {
    const logger = new Logger("error", { test: true });
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("refresh network error"));

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      defaultTokenEndpoint: "https://auth.example.com/token",
      logger,
    });

    await expect(
      client.fetchPatientMedications("patient-19", "https://fhir.example.com", {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        tokenType: "Bearer",
      }),
    ).rejects.toMatchObject({
      code: "FHIR_AUTH_REFRESH_ERROR",
    });
  });

  it("returns null for next link when relation is next but URL is blank", async () => {
    const logger = new Logger("error", { test: true });
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "MedicationRequest",
              status: "active",
            },
          },
        ],
        link: [
          {
            relation: "next",
            url: "   ",
          },
        ],
      }),
    );

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    const result = await client.fetchPatientMedications(
      "patient-20",
      "https://fhir.example.com",
      "token",
    );
    expect(result).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns unknown-host when safeHost receives invalid endpoint input", () => {
    const logger = new Logger("error", { test: true });
    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    const host = (
      client as unknown as { safeHost: (endpoint: string) => string }
    ).safeHost("not-a-url");
    expect(host).toBe("unknown-host");
  });

  it("executes request timeout callback before mapping AbortError", async () => {
    const logger = new Logger("error", { test: true });
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    const setTimeoutSpy = jest
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((handler: TimerHandler) => {
        if (typeof handler === "function") {
          handler();
        }

        return 0 as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);

    jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      logger,
    });

    await expect(
      client.fetchPatientMedications(
        "patient-21",
        "https://fhir.example.com",
        "token-abc",
      ),
    ).rejects.toMatchObject({
      code: "FHIR_TIMEOUT",
    });

    expect(setTimeoutSpy).toHaveBeenCalled();
  });

  it("executes refresh timeout callback before mapping AbortError", async () => {
    const logger = new Logger("error", { test: true });
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    const setTimeoutSpy = jest
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((handler: TimerHandler) => {
        if (typeof handler === "function") {
          handler();
        }

        return 0 as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);

    jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 50,
      maxPages: 10,
      defaultTokenEndpoint: "https://auth.example.com/token",
      logger,
    });

    await expect(
      client.fetchPatientMedications("patient-22", "https://fhir.example.com", {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        tokenType: "Bearer",
      }),
    ).rejects.toMatchObject({
      code: "FHIR_AUTH_REFRESH_ERROR",
    });

    expect(setTimeoutSpy).toHaveBeenCalled();
  });
});
