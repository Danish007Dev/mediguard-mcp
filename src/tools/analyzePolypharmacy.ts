import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError, toAppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import { sharpContextSchema, toSharpContext } from "../sharp/sharpContext";
import type { DecisionTraceService } from "../services/decisionTraceService";
import type { SharpContextDataService } from "../services/sharpContextFhirService";
import type { AnalyzePolypharmacyResult } from "../types/medicationSafety";

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

export const analyzePolypharmacyInputSchema = {
  patient_age: z
    .number()
    .int()
    .min(0, "Patient age cannot be negative.")
    .max(130, "Patient age appears invalid.")
    .describe("Patient age in years."),
  patient_conditions: z
    .array(z.string().trim().min(1))
    .max(100, "Maximum 100 conditions supported per request.")
    .default([])
    .describe("Known patient conditions or problem list entries."),
  current_medications: z
    .array(z.string().trim().min(1, "Medication names cannot be empty."))
    .max(75, "Maximum 75 medications supported per request.")
    .default([])
    .describe("Current active medication list."),
  sharp_context: sharpContextSchema
    .optional()
    .describe(
      "Optional SHARP context for auto-fetching medications and conditions from FHIR.",
    ),
  patient_context: z
    .object({})
    .passthrough()
    .optional()
    .describe("Optional SHARP or external patient context metadata."),
};

export const analyzePolypharmacyOutputSchema = {
  requestId: z.string().uuid(),
  source: z.literal("rules-llm"),
  analysisProvider: z.enum(["groq", "gemini", "rule-based"]),
  riskLevel: riskLevelSchema,
  isElderly: z.boolean(),
  medicationCount: z.number().int().nonnegative(),
  beersFlags: z.array(
    z.object({
      medication: z.string(),
      reason: z.string(),
      severity: z.enum(["moderate", "major"]),
      evidence: z.string(),
    }),
  ),
  duplicateTherapeuticClasses: z.array(
    z.object({
      className: z.string(),
      medications: z.array(z.string()),
      risk: z.enum(["low", "medium", "high"]),
      rationale: z.string(),
    }),
  ),
  drugBurdenIndex: z.number().nonnegative(),
  deprescribingOpportunities: z.array(
    z.object({
      medication: z.string(),
      rationale: z.string(),
      suggestedAction: z.string(),
      priority: z.enum(["low", "medium", "high"]),
    }),
  ),
  summary: z.string(),
  analysisRecommendations: z.array(z.string()),
  llmTrace: llmTraceSchema,
  llmTelemetry: llmTelemetrySchema,
  generatedAt: z.string(),
};

const inputObjectSchema = z.object(analyzePolypharmacyInputSchema);
const outputObjectSchema = z.object(analyzePolypharmacyOutputSchema);

export type AnalyzePolypharmacyInput = z.infer<typeof inputObjectSchema>;

interface AnalyzePolypharmacyService {
  analyzePolypharmacy(
    input: {
      patientAge: number;
      patientConditions: string[];
      currentMedications: string[];
    },
    requestId: string,
  ): Promise<AnalyzePolypharmacyResult>;
}

interface AnalyzePolypharmacyDependencies {
  service: AnalyzePolypharmacyService;
  logger: Logger;
  sharpContextService?: SharpContextDataService;
  traceService?: DecisionTraceService;
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

function buildResponseText(result: AnalyzePolypharmacyResult): string {
  const lines = [
    `Risk level: ${result.riskLevel} (analysis: ${result.analysisProvider})`,
    `Medication count: ${result.medicationCount}`,
    `Drug burden index: ${result.drugBurdenIndex}`,
    result.summary,
  ];

  if (result.beersFlags.length > 0) {
    lines.push(
      "Beers flags:",
      ...result.beersFlags.map(
        (flag, index) =>
          `${index + 1}. ${flag.medication} (${flag.severity}) - ${flag.reason}`,
      ),
    );
  }

  if (result.duplicateTherapeuticClasses.length > 0) {
    lines.push(
      "Duplicate therapeutic classes:",
      ...result.duplicateTherapeuticClasses.map(
        (flag, index) =>
          `${index + 1}. ${flag.className} [${flag.medications.join(", ")}] (${flag.risk})`,
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
 * Handles MCP execution for polypharmacy analysis with optional SHARP context hydration.
 */
export async function executeAnalyzePolypharmacy(
  args: AnalyzePolypharmacyInput,
  dependencies: AnalyzePolypharmacyDependencies,
): Promise<CallToolResult> {
  const requestId = randomUUID();
  const toolLogger = dependencies.logger.child({
    tool: "analyze_polypharmacy",
    requestId,
  });

  dependencies.traceService?.startTrace({
    requestId,
    toolName: "analyze_polypharmacy",
    inputSummary: {
      medicationCount: args.current_medications.length,
      patientConditionCount: args.patient_conditions.length,
      hasSharpContext: Boolean(args.sharp_context),
      hasPatientContext: Boolean(args.patient_context),
    },
  });

  try {
    const hydrationStepStartedAt = Date.now();
    const sharpContext = args.sharp_context
      ? toSharpContext(args.sharp_context)
      : undefined;

    const hydratedMedications =
      sharpContext && dependencies.sharpContextService
        ? await dependencies.sharpContextService.resolveMedications(
            sharpContext,
          )
        : [];

    const hydratedConditions =
      sharpContext && dependencies.sharpContextService
        ? await dependencies.sharpContextService.resolveConditions(sharpContext)
        : [];

    const currentMedications = asUnique([
      ...args.current_medications,
      ...hydratedMedications,
    ]);
    const patientConditions = asUnique([
      ...args.patient_conditions,
      ...hydratedConditions,
    ]);

    dependencies.traceService?.addStep({
      requestId,
      name: "context_hydration",
      status: "success",
      startedAt: hydrationStepStartedAt,
      finishedAt: Date.now(),
      details: {
        hydratedMedicationCount: hydratedMedications.length,
        hydratedConditionCount: hydratedConditions.length,
        finalMedicationCount: currentMedications.length,
        finalConditionCount: patientConditions.length,
      },
    });

    if (currentMedications.length === 0) {
      throw new AppError(
        "Provide at least one current medication, or supply sharp_context for FHIR hydration.",
        "VALIDATION_ERROR",
      );
    }

    if (sharpContext && dependencies.sharpContextService) {
      dependencies.sharpContextService.propagateContext(sharpContext);
    }

    toolLogger.info("Running polypharmacy analysis", {
      medicationCount: currentMedications.length,
      patientAge: args.patient_age,
      hasPatientContext: Boolean(args.patient_context),
      usedSharpContext: Boolean(sharpContext),
      hydratedMedicationCount: hydratedMedications.length,
      hydratedConditionCount: hydratedConditions.length,
    });

    const serviceStepStartedAt = Date.now();
    const result = await dependencies.service.analyzePolypharmacy(
      {
        patientAge: args.patient_age,
        patientConditions,
        currentMedications,
      },
      requestId,
    );

    dependencies.traceService?.addStep({
      requestId,
      name: "polypharmacy_analysis",
      status: "success",
      startedAt: serviceStepStartedAt,
      finishedAt: Date.now(),
      details: {
        analysisProvider: result.analysisProvider,
        source: result.source,
      },
    });

    const validationStepStartedAt = Date.now();
    const validatedResult = outputObjectSchema.parse(result);

    dependencies.traceService?.addStep({
      requestId,
      name: "output_validation",
      status: "success",
      startedAt: validationStepStartedAt,
      finishedAt: Date.now(),
      details: {
        riskLevel: validatedResult.riskLevel,
        beersFlags: validatedResult.beersFlags.length,
        duplicateClasses: validatedResult.duplicateTherapeuticClasses.length,
      },
    });

    toolLogger.info("Polypharmacy analysis completed", {
      riskLevel: validatedResult.riskLevel,
      beersFlags: validatedResult.beersFlags.length,
      duplicateClasses: validatedResult.duplicateTherapeuticClasses.length,
      provider: validatedResult.analysisProvider,
    });

    dependencies.traceService?.completeTrace({
      requestId,
      outputSummary: {
        status: "success",
        riskLevel: validatedResult.riskLevel,
        medicationCount: validatedResult.medicationCount,
        analysisProvider: validatedResult.analysisProvider,
      },
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
    const appError = toAppError(error, "Unable to analyze polypharmacy risk.");

    dependencies.traceService?.failTrace({
      requestId,
      code: appError.code,
      message: appError.message,
    });

    toolLogger.error("Polypharmacy analysis failed", {
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
