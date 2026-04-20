import {
  cloneSharpContext,
  sharpContextSchema,
  toSharpContext,
} from "../../src/sharp/sharpContext";

describe("sharpContext helpers", () => {
  it("maps string auth token input into internal SharpContext", () => {
    const parsed = sharpContextSchema.parse({
      patient_id: "patient-123",
      fhir_endpoint: "https://fhir.example.com",
      auth_token: "token-abc",
      workflow_id: "workflow-1",
      encounter_id: "encounter-1",
    });

    const result = toSharpContext(parsed);

    expect(result.patientId).toBe("patient-123");
    expect(result.fhirEndpoint).toBe("https://fhir.example.com");
    expect(result.authToken).toBe("token-abc");
    expect(result.workflowId).toBe("workflow-1");
    expect(result.encounterId).toBe("encounter-1");
  });

  it("maps OAuth token object input into internal SharpContext", () => {
    const parsed = sharpContextSchema.parse({
      patient_id: "patient-999",
      fhir_endpoint: "https://fhir.example.com",
      auth_token: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: "2030-01-01T00:00:00.000Z",
        token_endpoint: "https://auth.example.com/token",
        client_id: "client-id",
        client_secret: "client-secret",
        scope: "patient/*.read",
        token_type: "Bearer",
      },
    });

    const result = toSharpContext(parsed);

    expect(typeof result.authToken).toBe("object");
    const authToken = result.authToken as Exclude<
      typeof result.authToken,
      string
    >;
    expect(authToken.accessToken).toBe("access-token");
    expect(authToken.refreshToken).toBe("refresh-token");
    expect(authToken.tokenEndpoint).toBe("https://auth.example.com/token");
    expect(authToken.clientId).toBe("client-id");
    expect(authToken.clientSecret).toBe("client-secret");
    expect(authToken.scope).toBe("patient/*.read");
    expect(authToken.tokenType).toBe("Bearer");
  });

  it("clones string-token context without mutation", () => {
    const context = {
      patientId: "patient-1",
      fhirEndpoint: "https://fhir.example.com",
      authToken: "token-abc",
      workflowId: "workflow-1",
      encounterId: "encounter-1",
    };

    const cloned = cloneSharpContext(context);

    expect(cloned).toEqual(context);
    expect(cloned).not.toBe(context);
  });

  it("deep-clones oauth auth token object", () => {
    const context = {
      patientId: "patient-2",
      fhirEndpoint: "https://fhir.example.com",
      authToken: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: "2030-01-01T00:00:00.000Z",
        tokenEndpoint: "https://auth.example.com/token",
        clientId: "client-id",
        clientSecret: "client-secret",
        scope: "patient/*.read",
        tokenType: "Bearer",
      },
      workflowId: "workflow-2",
      encounterId: "encounter-2",
    };

    const cloned = cloneSharpContext(context);

    expect(cloned).toEqual(context);
    expect(cloned).not.toBe(context);
    expect(cloned.authToken).not.toBe(context.authToken);

    const clonedAuthToken = cloned.authToken as Exclude<
      typeof cloned.authToken,
      string
    >;
    const contextAuthToken = context.authToken as Exclude<
      typeof context.authToken,
      string
    >;
    clonedAuthToken.accessToken = "mutated";
    expect(contextAuthToken.accessToken).toBe("access");
  });

  it("rejects invalid sharp context with malformed fhir endpoint", () => {
    expect(() =>
      sharpContextSchema.parse({
        patient_id: "patient-1",
        fhir_endpoint: "not-a-url",
        auth_token: "token-abc",
      }),
    ).toThrow();
  });
});
