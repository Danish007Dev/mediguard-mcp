export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEYS = new Set([
  "authorization",
  "password",
  "secret",
  "token",
  "fhir_token",
  "api_key",
  "patient",
  "patient_id",
  "patientid",
  "name",
  "given",
  "family",
  "birthdate",
  "dob",
  "ssn",
  "mrn",
  "address",
  "phone",
  "email",
]);

const REDACTED_VALUE = "[REDACTED]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry));
  }

  if (isRecord(value)) {
    const sanitizedEntries = Object.entries(value).map(([key, entryValue]) => {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        return [key, REDACTED_VALUE] as const;
      }

      return [key, sanitize(entryValue)] as const;
    });

    return Object.fromEntries(sanitizedEntries);
  }

  return value;
}

/**
 * Structured logger with level filtering and recursive PHI/token redaction.
 */
export class Logger {
  public constructor(
    private readonly minLevel: LogLevel,
    private readonly baseContext: LogContext = {},
  ) {}

  /**
   * Creates a scoped child logger that inherits level and merges base context.
   */
  public child(context: LogContext): Logger {
    return new Logger(this.minLevel, {
      ...this.baseContext,
      ...context,
    });
  }

  public debug(message: string, context: LogContext = {}): void {
    this.log("debug", message, context);
  }

  public info(message: string, context: LogContext = {}): void {
    this.log("info", message, context);
  }

  public warn(message: string, context: LogContext = {}): void {
    this.log("warn", message, context);
  }

  public error(message: string, context: LogContext = {}): void {
    this.log("error", message, context);
  }

  private log(level: LogLevel, message: string, context: LogContext): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const sanitizedContext = sanitize({
      ...this.baseContext,
      ...context,
    });

    const contextObject = isRecord(sanitizedContext)
      ? sanitizedContext
      : { context: sanitizedContext };

    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...contextObject,
    });

    if (level === "warn" || level === "error") {
      console.error(logLine);
      return;
    }

    console.log(logLine);
  }
}
