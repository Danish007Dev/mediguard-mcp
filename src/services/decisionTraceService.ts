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

/**
 * Lightweight in-memory decision trace store for explainability and debugging.
 */
export class DecisionTraceService {
  private readonly traces = new Map<string, DecisionTraceRecord>();
  private readonly traceOrder: string[] = [];

  public constructor(private readonly maxRecords = 1000) {}

  public startTrace(input: StartTraceInput): void {
    const nowIso = new Date().toISOString();

    const record: DecisionTraceRecord = {
      requestId: input.requestId,
      toolName: input.toolName,
      startedAt: nowIso,
      finishedAt: nowIso,
      status: "success",
      inputSummary: input.inputSummary,
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
      details: input.details,
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
    trace.outputSummary = input.outputSummary;
    trace.finishedAt = new Date().toISOString();
  }

  public failTrace(input: FailTraceInput): void {
    const trace = this.traces.get(input.requestId);
    if (!trace) {
      return;
    }

    trace.status = "error";
    trace.error = {
      code: input.code,
      message: input.message,
    };
    trace.finishedAt = new Date().toISOString();
  }

  public getTrace(requestId: string): DecisionTraceRecord | undefined {
    return this.traces.get(requestId);
  }

  public listTraces(input: ListTraceInput = {}): DecisionTraceRecord[] {
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
    while (this.traceOrder.length > this.maxRecords) {
      const oldestRequestId = this.traceOrder.shift();
      if (!oldestRequestId) {
        return;
      }

      this.traces.delete(oldestRequestId);
    }
  }
}
