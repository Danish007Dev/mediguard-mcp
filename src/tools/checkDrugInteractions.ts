import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError, toAppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type { DrugInteractionService } from "../services/drugInteractionService";
import type { DecisionTraceService } from "../services/decisionTraceService";
import { sharpContextSchema, toSharpContext } from "../sharp/sharpContext";
import type { SharpContextDataService } from "../services/sharpContextFhirService";
import type { CheckDrugInteractionsResult } from "../types/medicationSafety";

const severitySchema = z.enum([
  "minor",
  "moderate",
  "major",
  "contraindicated",
]);
const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
const llmRiskSchema = z.enum(["low", "moderate", "high"]);

const patientContextInputSchema = z
  .object({
    age: z.number().int().min(0).max(130).optional(),
    conditions: z
      .array(z.string().trim().min(1, "Condition names cannot be empty."))
      .max(100)
      .default([]),
    renal_function: z.string().trim().min(1).optional(),
  })
  .passthrough();

export const checkDrugInteractionsInputSchema = {
  medications: z
    .array(z.string().trim().min(1, "Medication names cannot be empty."))
    .max(50, "A maximum of 50 medications is supported per request.")
    .default([])
    .describe("Array of medication names to evaluate for interactions."),
  sharp_context: sharpContextSchema
    .optional()
    .describe(
      "Optional SHARP context for auto-fetching patient medications from a FHIR server.",
    ),
  patient_context: z
    .union([patientContextInputSchema, z.object({}).passthrough()])
    .optional()
    .describe("Optional patient context for LLM-adapted interaction reasoning."),
};

export const checkDrugInteractionsOutputSchema = {
  requestId: z.string().uuid(),
  source: z.enum(["mock", "rxnorm-openfda"]),
  analysisProvider: z.enum(["groq", "gemini", "rule-based"]),
  riskLevel: riskLevelSchema,
  medications: z.array(z.string()),
  patientContext: z
    .object({
      age: z.number().int().optional(),
      conditions: z.array(z.string()),
      renalFunction: z.string().optional(),
    })
    .optional(),
  normalizedMedications: z.array(
    z.object({
      input: z.string(),
      normalizedName: z.string(),
      rxcui: z.string(),
      tty: z.string(),
      strategy: z.enum([
        "direct",
        "spelling-suggestion",
        "approximate",
        "rxcui-input",
      ]),
      genericMapped: z.boolean(),
    }),
  ),
  interactions: z.array(
    z.object({
      drugs: z.array(z.string()).min(2),
      severity: severitySchema,
      mechanism: z.string(),
      clinicalImpact: z.string(),
      recommendations: z.array(z.string()),
      evidence: z.string(),
    }),
  ),
  summary: z.string(),
  analysisRecommendations: z.array(z.string()),
  llmSynthesis: z
    .object({
      overallRisk: llmRiskSchema,
      contextualizedSummary: z.string(),
      interactionAnalyses: z.array(
        z.object({
          drug1: z.string(),
          drug2: z.string(),
          severity: llmRiskSchema,
          reasoning: z.string(),
          mechanism: z.string(),
          monitoringRecommendations: z.array(z.string()),
          saferAlternatives: z.array(z.string()),
        }),
      ),
      evidenceSummaries: z
        .array(
          z.object({
            drug1: z.string(),
            drug2: z.string(),
            evidenceLevel: z.enum(["A", "B", "C", "D"]),
            studyCount: z.number().int().nonnegative(),
            confidence: z.number().min(0).max(1),
            studies: z.array(
              z.object({
                pmid: z.string(),
                title: z.string(),
                journal: z.string(),
                published: z.string(),
                link: z.string().url(),
              }),
            ),
            synthesis: z.string(),
          }),
        )
        .optional(),
      trace: z
        .object({
          traceId: z.string().uuid(),
          cacheHit: z.boolean(),
          attemptedProviders: z.array(
            z.enum(["groq", "gemini", "rule-based"]),
          ),
          selectedProvider: z.enum(["groq", "gemini", "rule-based"]),
          fallbackUsed: z.boolean(),
          promptInteractionCount: z.number().int().nonnegative(),
          patientContextUsed: z.object({
            age: z.boolean(),
            conditions: z.boolean(),
            renalFunction: z.boolean(),
          }),
        })
        .optional(),
      telemetry: z
        .object({
          totalRequests: z.number().int().positive(),
          cacheHits: z.number().int().nonnegative(),
          cacheHitRate: z.number().min(0).max(1),
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
        .optional(),
    })
    .optional(),
  generatedAt: z.string(),
};

const inputObjectSchema = z.object(checkDrugInteractionsInputSchema);
const outputObjectSchema = z.object(checkDrugInteractionsOutputSchema);

export type CheckDrugInteractionsInput = z.infer<typeof inputObjectSchema>;

interface CheckDrugInteractionsDependencies {
  service: DrugInteractionService;
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

function buildResponseText(result: CheckDrugInteractionsResult): string {
  const header = `Risk level: ${result.riskLevel} (analysis: ${result.analysisProvider})`;

  if (result.interactions.length === 0) {
    const recommendations = result.analysisRecommendations
      .map((recommendation, index) => `${index + 1}. ${recommendation}`)
      .join("\n");

    return `${header}\n${result.summary}${
      recommendations ? `\nRecommendations:\n${recommendations}` : ""
    }`;
  }

  const interactions = result.interactions
    .map((interaction, index) => {
      const pair = interaction.drugs.join(" + ");
      return `${index + 1}. ${pair} (${interaction.severity}) - ${interaction.clinicalImpact}`;
    })
    .join("\n");

  const recommendations = result.analysisRecommendations
    .map((recommendation, index) => `${index + 1}. ${recommendation}`)
    .join("\n");

  return `${header}\n${result.summary}\n${interactions}${
    recommendations ? `\nRecommendations:\n${recommendations}` : ""
  }`;
}

/**
 * Handles MCP execution for interaction checks, including optional SHARP hydration.
 */
export async function executeCheckDrugInteractions(
  args: CheckDrugInteractionsInput,
  dependencies: CheckDrugInteractionsDependencies,
): Promise<CallToolResult> {
  const requestId = randomUUID();
  const toolLogger = dependencies.logger.child({
    tool: "check_drug_interactions",
    requestId,
  });

  dependencies.traceService?.startTrace({
    requestId,
    toolName: "check_drug_interactions",
    inputSummary: {
      medicationCount: args.medications.length,
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
        ? (await dependencies.sharpContextService.resolveMedications(
            sharpContext,
          )) ?? []
        : [];

    const hydratedConditions =
      sharpContext && dependencies.sharpContextService
        ? (await dependencies.sharpContextService.resolveConditions(
            sharpContext,
          )) ?? []
        : [];

    dependencies.traceService?.addStep({
      requestId,
      name: "context_hydration",
      status: "success",
      startedAt: hydrationStepStartedAt,
      finishedAt: Date.now(),
      details: {
        hydratedMedicationCount: hydratedMedications.length,
        hydratedConditionCount: hydratedConditions.length,
        usedSharpContext: Boolean(sharpContext),
      },
    });

    const medications = asUnique([...args.medications, ...hydratedMedications]);

    const inputPatientContext = patientContextInputSchema
      .safeParse(args.patient_context)
      .success
      ? patientContextInputSchema.parse(args.patient_context)
      : undefined;

    const patientContext =
      inputPatientContext || hydratedConditions.length > 0
        ? {
            age: inputPatientContext?.age,
            conditions: asUnique([
              ...(inputPatientContext?.conditions ?? []),
              ...hydratedConditions,
            ]),
            renalFunction: inputPatientContext?.renal_function,
          }
        : undefined;

    if (medications.length < 2) {
      throw new AppError(
        "Provide at least two medications, or supply sharp_context so medications can be auto-fetched from FHIR.",
        "VALIDATION_ERROR",
      );
    }

    if (sharpContext && dependencies.sharpContextService) {
      dependencies.sharpContextService.propagateContext(sharpContext);
    }

    toolLogger.info("Running medication interaction check", {
      medicationCount: medications.length,
      usedSharpContext: Boolean(sharpContext),
      hydratedMedicationCount: hydratedMedications.length,
      hydratedConditionCount: hydratedConditions.length,
      hasPatientContext: Boolean(patientContext),
    });

    const serviceStepStartedAt = Date.now();
    const result = await dependencies.service.checkDrugInteractions(
      medications,
      requestId,
      patientContext,
    );

    dependencies.traceService?.addStep({
      requestId,
      name: "interaction_analysis",
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
        interactionCount: validatedResult.interactions.length,
        riskLevel: validatedResult.riskLevel,
      },
    });

    toolLogger.info("Medication interaction check completed", {
      interactionCount: validatedResult.interactions.length,
      riskLevel: validatedResult.riskLevel,
    });

    dependencies.traceService?.completeTrace({
      requestId,
      outputSummary: {
        status: "success",
        riskLevel: validatedResult.riskLevel,
        interactionCount: validatedResult.interactions.length,
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
    const appError = toAppError(
      error,
      "Unable to evaluate medication interactions.",
    );

    dependencies.traceService?.failTrace({
      requestId,
      code: appError.code,
      message: appError.message,
    });

    toolLogger.error("Medication interaction check failed", {
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
