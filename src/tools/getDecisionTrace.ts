import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError, toAppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type { DecisionTraceService } from "../services/decisionTraceService";

export const getDecisionTraceInputSchema = {
  request_id: z
    .string()
    .uuid("request_id must be a valid UUID.")
    .optional()
    .describe("Optional request ID to fetch a specific trace."),
  tool_name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional tool name filter when listing traces."),
  status: z
    .enum(["success", "error"])
    .optional()
    .describe("Optional status filter when listing traces."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Maximum number of traces to return when listing."),
};

export const getDecisionTraceOutputSchema = {
  traces: z.array(
    z.object({
      requestId: z.string().uuid(),
      toolName: z.string(),
      startedAt: z.string(),
      finishedAt: z.string(),
      status: z.enum(["success", "error"]),
      inputSummary: z.record(z.string(), z.unknown()),
      outputSummary: z.record(z.string(), z.unknown()).optional(),
      steps: z.array(
        z.object({
          name: z.string(),
          status: z.enum(["success", "warning", "error"]),
          startedAt: z.string(),
          finishedAt: z.string(),
          durationMs: z.number().int().nonnegative(),
          details: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .optional(),
    }),
  ),
};

const inputObjectSchema = z.object(getDecisionTraceInputSchema);
const outputObjectSchema = z.object(getDecisionTraceOutputSchema);

export type GetDecisionTraceInput = z.input<typeof inputObjectSchema>;

interface GetDecisionTraceDependencies {
  traceService: DecisionTraceService;
  logger: Logger;
}

/**
 * Returns decision traces for explainability and debugging.
 */
export async function executeGetDecisionTrace(
  args: GetDecisionTraceInput,
  dependencies: GetDecisionTraceDependencies,
): Promise<CallToolResult> {
  const toolLogger = dependencies.logger.child({
    tool: "get_decision_trace",
  });

  try {
    const parsedArgs = inputObjectSchema.parse(args);
    let traces;

    if (parsedArgs.request_id) {
      const found = dependencies.traceService.getTrace(parsedArgs.request_id);
      if (!found) {
        throw new AppError(
          `No decision trace found for request_id '${parsedArgs.request_id}'.`,
          "NOT_FOUND",
        );
      }

      traces = [found];
    } else {
      traces = dependencies.traceService.listTraces({
        limit: parsedArgs.limit,
        toolName: parsedArgs.tool_name,
        status: parsedArgs.status,
      });
    }

    const validated = outputObjectSchema.parse({ traces });

    toolLogger.info("Decision trace retrieval completed", {
      traceCount: validated.traces.length,
      requestIdFilter: parsedArgs.request_id,
      toolNameFilter: parsedArgs.tool_name,
      statusFilter: parsedArgs.status,
    });

    return {
      content: [
        {
          type: "text",
          text: `Returned ${validated.traces.length} decision trace(s).`,
        },
      ],
      structuredContent: validated,
    };
  } catch (error) {
    const appError = toAppError(error, "Unable to fetch decision traces.");

    toolLogger.error("Decision trace retrieval failed", {
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
