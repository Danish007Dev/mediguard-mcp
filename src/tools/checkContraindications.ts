import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toAppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import { sharpContextSchema, toSharpContext } from "../sharp/sharpContext";
import type { SharpContextDataService } from "../services/sharpContextFhirService";
import type { CheckContraindicationsResult } from "../types/medicationSafety";

const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
const llmTraceSchema = z
  .object({
    traceId: z.string(),
    cacheHit: z.boolean(),
    attemptedProviders: z.array(z.enum(["groq", "gemini", "rule-based"])),
    selectedProvider: z.enum(["groq", "gemini", "rule-based"]),
    fallbackUsed: z.boolean(),
    promptInteractionCount: z.number().int().nonnegative(),
    patientContextUsed: z.object({
      age: z.boolean(),
      conditions: z.boolean(),
      renalFunction: z.boolean(),
    }),
  })
  .optional();

const llmTelemetrySchema = z
  .object({
    totalRequests: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    cacheHitRate: z.number().nonnegative(),
    providerCalls: z.object({
      groq: z.number().int().nonnegative(),
      gemini: z.number().int().nonnegative(),
      ruleBased: z.number().int().nonnegative(),
    }),
    estimatedPromptTokens: z.number().int().nonnegative(),
    estimatedCompletionTokens: z.number().int().nonnegative(),
    estimatedTotalTokens: z.number().int().nonnegative(),
    estimatedSpendUsd: z.number().nonnegative(),
  })
  .optional();

export const checkContraindicationsInputSchema = {
  proposed_medication: z
    .string()
    .trim()
    .min(1, "Proposed medication is required.")
    .describe("Medication being considered for prescribing."),
  patient_allergies: z
    .array(z.string().trim().min(1))
    .max(100, "Maximum 100 allergies are supported per request.")
    .default([])
    .describe("Documented patient allergy list."),
  patient_conditions: z
    .array(z.string().trim().min(1))
    .max(100, "Maximum 100 conditions are supported per request.")
    .default([])
    .describe("Known patient conditions and problem-list entries."),
  lab_values: z
    .object({})
    .passthrough()
    .optional()
    .describe(
      "Optional recent labs such as eGFR, creatinine, AST, ALT, potassium.",
    ),
  sharp_context: sharpContextSchema
    .optional()
    .describe(
      "Optional SHARP context for auto-fetching allergies and conditions from FHIR.",
    ),
  patient_context: z
    .object({})
    .passthrough()
    .optional()
    .describe("Optional SHARP or external patient context metadata."),
};

export const checkContraindicationsOutputSchema = {
  requestId: z.string().uuid(),
  source: z.literal("rules-dailymed"),
  analysisProvider: z.enum(["groq", "gemini", "rule-based"]),
  riskLevel: riskLevelSchema,
  contraindicated: z.boolean(),
  proposedMedication: z.string(),
  contraindications: z.array(
    z.object({
      medication: z.string(),
      trigger: z.enum([
        "allergy",
        "condition",
        "lab",
        "pregnancy",
        "label-warning",
      ]),
      severity: z.enum(["moderate", "major", "contraindicated"]),
      rationale: z.string(),
      recommendation: z.string(),
      evidence: z.string(),
      source: z.enum(["rules", "dailymed"]),
    }),
  ),
  summary: z.string(),
  analysisRecommendations: z.array(z.string()),
  llmTrace: llmTraceSchema,
  llmTelemetry: llmTelemetrySchema,
  labelEvidence: z.object({
    setId: z.string().optional(),
    title: z.string().optional(),
    contraindications: z.array(z.string()),
    warnings: z.array(z.string()),
    pregnancy: z.array(z.string()),
    renal: z.array(z.string()),
    hepatic: z.array(z.string()),
  }),
  generatedAt: z.string(),
};

const inputObjectSchema = z.object(checkContraindicationsInputSchema);
const outputObjectSchema = z.object(checkContraindicationsOutputSchema);

export type CheckContraindicationsInput = z.infer<typeof inputObjectSchema>;

interface CheckContraindicationsService {
  checkContraindications(
    input: {
      proposedMedication: string;
      patientAllergies: string[];
      patientConditions: string[];
      labValues?: Record<string, unknown>;
    },
    requestId: string,
  ): Promise<CheckContraindicationsResult>;
}

interface CheckContraindicationsDependencies {
  service: CheckContraindicationsService;
  logger: Logger;
  sharpContextService?: SharpContextDataService;
}

function asUnique(values: string[]): string[] {
  const map = new Map<string, string>();

  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (!map.has(key)) {
      map.set(key, cleaned);
    }
  }

  return Array.from(map.values());
}

function buildResponseText(result: CheckContraindicationsResult): string {
  const lines = [
    `Risk level: ${result.riskLevel} (analysis: ${result.analysisProvider})`,
    `Contraindicated: ${result.contraindicated ? "yes" : "no"}`,
    result.summary,
  ];

  if (result.contraindications.length > 0) {
    lines.push(
      "Findings:",
      ...result.contraindications.map(
        (finding, index) =>
          `${index + 1}. ${finding.severity} [${finding.trigger}] - ${finding.rationale}`,
      ),
    );
  }

  if (result.analysisRecommendations.length > 0) {
    lines.push(
      "Recommendations:",
      ...result.analysisRecommendations.map(
        (item, index) => `${index + 1}. ${item}`,
      ),
    );
  }

  return lines.join("\n");
}

/**
 * Handles MCP execution for contraindication checks with optional FHIR-backed SHARP hydration.
 */
export async function executeCheckContraindications(
  args: CheckContraindicationsInput,
  dependencies: CheckContraindicationsDependencies,
): Promise<CallToolResult> {
  const requestId = randomUUID();
  const toolLogger = dependencies.logger.child({
    tool: "check_contraindications",
    requestId,
  });

  try {
    const sharpContext = args.sharp_context
      ? toSharpContext(args.sharp_context)
      : undefined;

    const hydratedAllergies =
      sharpContext && dependencies.sharpContextService
        ? await dependencies.sharpContextService.resolveAllergies(sharpContext)
        : [];

    const hydratedConditions =
      sharpContext && dependencies.sharpContextService
        ? await dependencies.sharpContextService.resolveConditions(sharpContext)
        : [];

    const patientAllergies = asUnique([
      ...args.patient_allergies,
      ...hydratedAllergies,
    ]);
    const patientConditions = asUnique([
      ...args.patient_conditions,
      ...hydratedConditions,
    ]);

    if (sharpContext && dependencies.sharpContextService) {
      dependencies.sharpContextService.propagateContext(sharpContext);
    }

    toolLogger.info("Running contraindication check", {
      allergyCount: patientAllergies.length,
      conditionCount: patientConditions.length,
      hasLabs: Boolean(args.lab_values),
      hasPatientContext: Boolean(args.patient_context),
      usedSharpContext: Boolean(sharpContext),
      hydratedAllergyCount: hydratedAllergies.length,
      hydratedConditionCount: hydratedConditions.length,
    });

    const result = await dependencies.service.checkContraindications(
      {
        proposedMedication: args.proposed_medication,
        patientAllergies,
        patientConditions,
        labValues: args.lab_values,
      },
      requestId,
    );

    const validatedResult = outputObjectSchema.parse(result);

    toolLogger.info("Contraindication check completed", {
      riskLevel: validatedResult.riskLevel,
      contraindicated: validatedResult.contraindicated,
      findingCount: validatedResult.contraindications.length,
      provider: validatedResult.analysisProvider,
    });

    return {
      content: [
        {
          type: "text",
          text: buildResponseText(validatedResult),
        },
      ],
      structuredContent: validatedResult,
    };
  } catch (error) {
    const appError = toAppError(
      error,
      "Unable to evaluate medication contraindications.",
    );

    toolLogger.error("Contraindication check failed", {
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
