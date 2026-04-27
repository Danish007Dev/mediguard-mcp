import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toAppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type { DecisionTraceService } from "../services/decisionTraceService";

export const getDecisionTraceDashboardInputSchema = {
  tool_name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional tool name filter for dashboard metrics."),
  window_minutes: z
    .number()
    .int()
    .min(1)
    .max(10080)
    .default(1440)
    .describe("Window size in minutes for dashboard aggregation."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum recent traces to include."),
};

export const getDecisionTraceDashboardOutputSchema = {
  generatedAt: z.string(),
  windowMinutes: z.number().int().min(1),
  summary: z.object({
    totalTraces: z.number().int().nonnegative(),
    successCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
  }),
  toolBreakdown: z.array(
    z.object({
      toolName: z.string(),
      total: z.number().int().nonnegative(),
      successCount: z.number().int().nonnegative(),
      errorCount: z.number().int().nonnegative(),
      averageDurationMs: z.number().int().nonnegative(),
      p95DurationMs: z.number().int().nonnegative(),
      lastSeenAt: z.string(),
    }),
  ),
  recentTraces: z.array(
    z.object({
      requestId: z.string().uuid(),
      toolName: z.string(),
      status: z.enum(["success", "error"]),
      startedAt: z.string(),
      finishedAt: z.string(),
      totalDurationMs: z.number().int().nonnegative(),
      stepCount: z.number().int().nonnegative(),
      errorCode: z.string().optional(),
    }),
  ),
};

const inputObjectSchema = z.object(getDecisionTraceDashboardInputSchema);
const outputObjectSchema = z.object(getDecisionTraceDashboardOutputSchema);

export type GetDecisionTraceDashboardInput = z.input<typeof inputObjectSchema>;

interface GetDecisionTraceDashboardDependencies {
  traceService: DecisionTraceService;
  logger: Logger;
}

/**
 * Returns dashboard-ready aggregate decision trace metrics.
 */
export async function executeGetDecisionTraceDashboard(
  args: GetDecisionTraceDashboardInput,
  dependencies: GetDecisionTraceDashboardDependencies,
): Promise<CallToolResult> {
  const toolLogger = dependencies.logger.child({
    tool: "get_decision_trace_dashboard",
  });

  try {
    const parsedArgs = inputObjectSchema.parse(args);

    const artifact = dependencies.traceService.getDashboard({
      toolName: parsedArgs.tool_name,
      windowMinutes: parsedArgs.window_minutes,
      limit: parsedArgs.limit,
    });

    const validated = outputObjectSchema.parse(artifact);

    toolLogger.info("Decision trace dashboard retrieval completed", {
      totalTraces: validated.summary.totalTraces,
      successRate: validated.summary.successRate,
      toolNameFilter: parsedArgs.tool_name,
      windowMinutes: parsedArgs.window_minutes,
    });

    return {
      content: [
        {
          type: "text",
          text: `Decision trace dashboard returned ${validated.summary.totalTraces} trace(s) with success rate ${(validated.summary.successRate * 100).toFixed(1)}%.`,
        },
      ],
      structuredContent: validated,
    };
  } catch (error) {
    const appError = toAppError(error, "Unable to fetch decision trace dashboard.");

    toolLogger.error("Decision trace dashboard retrieval failed", {
      code: appError.code,
      message: appError.message,
      details: appError.details,
    });

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error [${appError.code}]: ${appError.message}`,
        },
      ],
    };
  }
}
