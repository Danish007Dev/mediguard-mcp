import { Logger } from "../../src/logging/logger";

describe("Logger", () => {
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

  it("writes debug logs and sanitizes sensitive fields inside arrays", () => {
    const logger = new Logger("debug", { component: "logger-test" });

    logger.debug("debug-message", {
      events: [
        { type: "ok", token: "secret-token" },
        { type: "ok", nested: { patient_id: "patient-123" } },
      ],
    });

    const rawLog = String(consoleLogSpy.mock.calls[0]?.[0] ?? "");
    const payload = JSON.parse(rawLog) as {
      events: Array<Record<string, unknown>>;
      component: string;
      level: string;
      message: string;
    };

    expect(payload.level).toBe("debug");
    expect(payload.message).toBe("debug-message");
    expect(payload.component).toBe("logger-test");
    expect(payload.events[0]?.token).toBe("[REDACTED]");
    expect(
      (payload.events[1]?.nested as Record<string, unknown>)?.patient_id,
    ).toBe("[REDACTED]");
  });

  it("suppresses logs below configured minimum level", () => {
    const logger = new Logger("warn");
    logger.info("info-message");

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
