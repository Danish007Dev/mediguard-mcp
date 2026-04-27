import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  DecisionTraceRecord,
  DecisionTraceStep,
} from "../types/medicationSafety";

interface StartTraceInput {
  requestId: string;
  toolName: string;
  inputSummary: Record<string, unknown>;
}

interface AddStepInput {
  requestId: string;
  name: string;
  startedAt: number;
  finishedAt: number;
  status: "success" | "warning" | "error";
  details?: Record<string, unknown>;
}

interface CompleteTraceInput {
  requestId: string;
  outputSummary: Record<string, unknown>;
}

interface FailTraceInput {
  requestId: string;
  code: string;
  message: string;
}

interface ListTraceInput {
  limit?: number;
  toolName?: string;
  status?: "success" | "error";
}

interface DecisionTraceServiceOptions {
  maxRecords?: number;
  maxAgeMs?: number;
  archivePath?: string;
  nowProvider?: () => number;
}

const DEFAULT_MAX_RECORDS = 1000;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /(patient.?id|name|dob|birth|ssn|mrn|email|phone|address|identifier|auth.?token|token|authorization)/i;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;
const PHONE_PATTERN = /(?:\+?\d{1,2}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}\b/;

function sanitizeString(value: string): string {
  if (EMAIL_PATTERN.test(value) || SSN_PATTERN.test(value) || PHONE_PATTERN.test(value)) {
    return REDACTED;
  }

  if (value.length > 500) {
    return `${value.slice(0, 500)}...(truncated)`;
  }

  return value;
}

function sanitizeUnknown(value: unknown, keyHint?: string): unknown {
  if (keyHint && SENSITIVE_KEY_PATTERN.test(keyHint)) {
    return REDACTED;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item));
  }

  if (value && typeof value === "object") {
    const inputObject = value as Record<string, unknown>;
    const outputObject: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(inputObject)) {
      outputObject[key] = sanitizeUnknown(nestedValue, key);
    }

    return outputObject;
  }

  return value;
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  return sanitizeUnknown(record) as Record<string, unknown>;
}

/**
 * Decision trace store with bounded in-memory retention, PHI-safe redaction,
 * and optional append-only archive persistence for forensic replay.
 */
export class DecisionTraceService {
  private readonly traces = new Map<string, DecisionTraceRecord>();
  private readonly traceOrder: string[] = [];
  private readonly persistedRequestIds = new Set<string>();
  private readonly maxRecords: number;
  private readonly maxAgeMs: number;
  private readonly archivePath?: string;
  private readonly nowProvider: () => number;

  public constructor(options: number | DecisionTraceServiceOptions = {}) {
    if (typeof options === "number") {
      this.maxRecords = options;
      this.maxAgeMs = DEFAULT_MAX_AGE_MS;
      this.nowProvider = () => Date.now();
      return;
    }

    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.archivePath = options.archivePath;
    this.nowProvider = options.nowProvider ?? (() => Date.now());
  }

  public startTrace(input: StartTraceInput): void {
    const nowIso = this.nowIso();

    const record: DecisionTraceRecord = {
      requestId: input.requestId,
      toolName: input.toolName,
      startedAt: nowIso,
      finishedAt: nowIso,
      status: "success",
      inputSummary: sanitizeRecord(input.inputSummary),
      steps: [],
    };

    this.traces.set(input.requestId, record);
    this.traceOrder.push(input.requestId);
    this.evictIfNeeded();
  }

  public addStep(input: AddStepInput): void {
    const trace = this.traces.get(input.requestId);
    if (!trace) {
      return;
    }

    const step: DecisionTraceStep = {
      name: input.name,
      status: input.status,
      startedAt: new Date(input.startedAt).toISOString(),
      finishedAt: new Date(input.finishedAt).toISOString(),
      durationMs: Math.max(0, input.finishedAt - input.startedAt),
      details: input.details ? sanitizeRecord(input.details) : undefined,
    };

    trace.steps.push(step);
    trace.finishedAt = step.finishedAt;
  }

  public completeTrace(input: CompleteTraceInput): void {
    const trace = this.traces.get(input.requestId);
    if (!trace) {
      return;
    }

    trace.status = "success";
    trace.outputSummary = sanitizeRecord(input.outputSummary);
    trace.finishedAt = this.nowIso();
    this.persistTrace(trace);
  }

  public failTrace(input: FailTraceInput): void {
    const trace = this.traces.get(input.requestId);
    if (!trace) {
      return;
    }

    trace.status = "error";
    trace.error = {
      code: input.code,
      message: sanitizeString(input.message),
    };
    trace.finishedAt = this.nowIso();
    this.persistTrace(trace);
  }

  public getTrace(requestId: string): DecisionTraceRecord | undefined {
    this.evictExpiredIfNeeded();
    return this.traces.get(requestId);
  }

  public listTraces(input: ListTraceInput = {}): DecisionTraceRecord[] {
    this.evictExpiredIfNeeded();
    const limit = Math.min(100, Math.max(1, input.limit ?? 10));

    const ordered = [...this.traceOrder]
      .reverse()
      .map((requestId) => this.traces.get(requestId))
      .filter((item): item is DecisionTraceRecord => Boolean(item));

    return ordered
      .filter((trace) => (input.toolName ? trace.toolName === input.toolName : true))
      .filter((trace) => (input.status ? trace.status === input.status : true))
      .slice(0, limit);
  }

  private evictIfNeeded(): void {
    this.evictExpiredIfNeeded();

    while (this.traceOrder.length > this.maxRecords) {
      const oldestRequestId = this.traceOrder.shift();
      if (!oldestRequestId) {
        return;
      }

      this.traces.delete(oldestRequestId);
    }
  }

  private evictExpiredIfNeeded(): void {
    if (this.maxAgeMs <= 0) {
      return;
    }

    const cutoff = this.nowProvider() - this.maxAgeMs;

    while (this.traceOrder.length > 0) {
      const oldestRequestId = this.traceOrder[0];
      if (!oldestRequestId) {
        return;
      }

      const trace = this.traces.get(oldestRequestId);
      if (!trace) {
        this.traceOrder.shift();
        continue;
      }

      const finishedAtTime = Date.parse(trace.finishedAt);
      if (Number.isNaN(finishedAtTime) || finishedAtTime >= cutoff) {
        return;
      }

      this.traceOrder.shift();
      this.traces.delete(oldestRequestId);
      this.persistedRequestIds.delete(oldestRequestId);
    }
  }

  private persistTrace(trace: DecisionTraceRecord): void {
    if (!this.archivePath || this.persistedRequestIds.has(trace.requestId)) {
      return;
    }

    try {
      mkdirSync(dirname(this.archivePath), { recursive: true });
      appendFileSync(this.archivePath, `${JSON.stringify(trace)}\n`, {
        encoding: "utf8",
      });
      this.persistedRequestIds.add(trace.requestId);
    } catch {
      // Best-effort archival only; runtime tool behavior should not fail on archive I/O.
    }
  }

  private nowIso(): string {
    return new Date(this.nowProvider()).toISOString();
  }
}
