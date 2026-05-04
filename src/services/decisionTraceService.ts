import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  DecisionTraceDashboardArtifact,
  DecisionTraceRecentItem,
  DecisionTraceToolBreakdown,
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

interface DecisionTraceDashboardInput {
  limit?: number;
  toolName?: string;
  windowMinutes?: number;
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
const PHONE_PATTERN =
  /(?:\+?\d{1,2}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}\b/;

function percentile(values: number[], percentileRank: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileRank * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function sanitizeString(value: string): string {
  if (
    EMAIL_PATTERN.test(value) ||
    SSN_PATTERN.test(value) ||
    PHONE_PATTERN.test(value)
  ) {
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

function sanitizeRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeUnknown(record) as Record<string, unknown>;
}

function isDecisionTraceRecord(value: unknown): value is DecisionTraceRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DecisionTraceRecord>;
  return (
    typeof candidate.requestId === "string" &&
    typeof candidate.toolName === "string" &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.finishedAt === "string" &&
    (candidate.status === "success" || candidate.status === "error") &&
    Array.isArray(candidate.steps)
  );
}

function computeTotalDurationMs(trace: DecisionTraceRecord): number {
  const startedAt = Date.parse(trace.startedAt);
  const finishedAt = Date.parse(trace.finishedAt);

  if (!Number.isNaN(startedAt) && !Number.isNaN(finishedAt)) {
    return Math.max(0, finishedAt - startedAt);
  }

  return trace.steps.reduce((sum, step) => sum + step.durationMs, 0);
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

    this.loadArchive();
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
      .filter((trace) =>
        input.toolName ? trace.toolName === input.toolName : true,
      )
      .filter((trace) => (input.status ? trace.status === input.status : true))
      .slice(0, limit);
  }

  public getDashboard(
    input: DecisionTraceDashboardInput = {},
  ): DecisionTraceDashboardArtifact {
    this.evictExpiredIfNeeded();

    const windowMinutes = Math.min(
      7 * 24 * 60,
      Math.max(1, input.windowMinutes ?? 24 * 60),
    );
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));

    const cutoffIso = new Date(
      this.nowProvider() - windowMinutes * 60 * 1000,
    ).toISOString();

    const traces = [...this.traceOrder]
      .reverse()
      .map((requestId) => this.traces.get(requestId))
      .filter((item): item is DecisionTraceRecord => Boolean(item))
      .filter((trace) => trace.finishedAt >= cutoffIso)
      .filter((trace) =>
        input.toolName ? trace.toolName === input.toolName : true,
      );

    const successCount = traces.filter(
      (trace) => trace.status === "success",
    ).length;
    const errorCount = traces.length - successCount;
    const successRate = traces.length > 0 ? successCount / traces.length : 0;

    const byTool = new Map<string, DecisionTraceRecord[]>();
    for (const trace of traces) {
      const group = byTool.get(trace.toolName);
      if (group) {
        group.push(trace);
      } else {
        byTool.set(trace.toolName, [trace]);
      }
    }

    const toolBreakdown: DecisionTraceToolBreakdown[] = [...byTool.entries()]
      .map(([toolName, toolTraces]) => {
        const durations = toolTraces.map((trace) =>
          computeTotalDurationMs(trace),
        );
        const toolSuccess = toolTraces.filter(
          (trace) => trace.status === "success",
        ).length;

        return {
          toolName,
          total: toolTraces.length,
          successCount: toolSuccess,
          errorCount: toolTraces.length - toolSuccess,
          averageDurationMs:
            toolTraces.length > 0
              ? Math.round(
                  durations.reduce((sum, ms) => sum + ms, 0) /
                    toolTraces.length,
                )
              : 0,
          p95DurationMs: percentile(durations, 0.95),
          lastSeenAt: toolTraces[0]?.finishedAt ?? new Date(0).toISOString(),
        };
      })
      .sort((left, right) => right.total - left.total);

    const recentTraces: DecisionTraceRecentItem[] = traces
      .slice(0, limit)
      .map((trace) => ({
        requestId: trace.requestId,
        toolName: trace.toolName,
        status: trace.status,
        startedAt: trace.startedAt,
        finishedAt: trace.finishedAt,
        totalDurationMs: computeTotalDurationMs(trace),
        stepCount: trace.steps.length,
        errorCode: trace.error?.code,
      }));

    return {
      generatedAt: this.nowIso(),
      windowMinutes,
      summary: {
        totalTraces: traces.length,
        successCount,
        errorCount,
        successRate,
      },
      toolBreakdown,
      recentTraces,
    };
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

  private loadArchive(): void {
    if (!this.archivePath || !existsSync(this.archivePath)) {
      return;
    }

    try {
      const file = readFileSync(this.archivePath, "utf8");
      const lines = file
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!isDecisionTraceRecord(parsed)) {
            continue;
          }

          const restored: DecisionTraceRecord = {
            requestId: parsed.requestId,
            toolName: parsed.toolName,
            startedAt: parsed.startedAt,
            finishedAt: parsed.finishedAt,
            status: parsed.status,
            inputSummary: sanitizeRecord(parsed.inputSummary),
            outputSummary: parsed.outputSummary
              ? sanitizeRecord(parsed.outputSummary)
              : undefined,
            steps: Array.isArray(parsed.steps)
              ? parsed.steps.map((step) => ({
                  ...step,
                  details: step.details
                    ? sanitizeRecord(step.details as Record<string, unknown>)
                    : undefined,
                }))
              : [],
            error: parsed.error
              ? {
                  code: parsed.error.code,
                  message: sanitizeString(parsed.error.message),
                }
              : undefined,
          };

          this.traces.set(restored.requestId, restored);
          this.traceOrder.push(restored.requestId);
          this.persistedRequestIds.add(restored.requestId);
        } catch {
          continue;
        }
      }

      this.evictIfNeeded();
    } catch {
      // Archive replay is best-effort only and should not block server startup.
    }
  }

  private nowIso(): string {
    return new Date(this.nowProvider()).toISOString();
  }
}
