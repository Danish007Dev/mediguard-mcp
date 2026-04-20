import { Logger } from "../../src/logging/logger";

describe("Phase 4 HIPAA compliance audit", () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("redacts PHI and auth fields in info logs", () => {
    const logger = new Logger("info", { component: "audit-test" });

    logger.info("Testing HIPAA-safe logging", {
      patient_id: "patient-123",
      name: "Jane Doe",
      token: "secret-token",
      nested: {
        mrn: "MRN-5678",
        email: "patient@example.com",
      },
      safeField: "retain-this",
    });

    const rawLog = String(consoleLogSpy.mock.calls[0]?.[0] ?? "");
    const payload = JSON.parse(rawLog) as Record<string, unknown>;
    const nested = payload["nested"] as Record<string, unknown>;

    expect(payload["patient_id"]).toBe("[REDACTED]");
    expect(payload["name"]).toBe("[REDACTED]");
    expect(payload["token"]).toBe("[REDACTED]");
    expect(nested["mrn"]).toBe("[REDACTED]");
    expect(nested["email"]).toBe("[REDACTED]");
    expect(payload["safeField"]).toBe("retain-this");

    expect(rawLog).not.toContain("Jane Doe");
    expect(rawLog).not.toContain("MRN-5678");
    expect(rawLog).not.toContain("secret-token");
  });

  it("redacts Authorization regardless of casing", () => {
    const logger = new Logger("error", { component: "audit-test" });

    logger.error("Authorization redaction", {
      Authorization: "Bearer highly-sensitive-token",
    });

    const rawLog = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    const payload = JSON.parse(rawLog) as Record<string, unknown>;

    expect(payload["Authorization"]).toBe("[REDACTED]");
    expect(rawLog).not.toContain("highly-sensitive-token");
  });
});
