import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toAppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import { sharpContextSchema, toSharpContext } from "../sharp/sharpContext";
import type { SharpContextDataService } from "../services/sharpContextFhirService";
import type { GetSaferAlternativesResult } from "../types/medicationSafety";

const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export const getSaferAlternativesInputSchema = {
  proposed_medication: z
    .string()
    .trim()
    .min(1, "Proposed medication is required.")
    .describe("Medication that needs a safer alternative."),
  current_medications: z
    .array(z.string().trim().min(1))
    .max(100, "Maximum 100 current medications are supported per request.")
    .default([])
    .describe("Current active medication list."),
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
  formulary_preferred: z
    .array(z.string().trim().min(1))
    .max(100, "Maximum 100 formulary entries are supported per request.")
    .default([])
    .describe(
      "Optional list of formulary-preferred medications to prioritize when clinically equivalent.",
    ),
  max_alternatives: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("Maximum number of alternatives to return."),
  sharp_context: sharpContextSchema
    .optional()
    .describe(
      "Optional SHARP context for auto-fetching meds, allergies, and conditions from FHIR.",
    ),
  patient_context: z
    .object({})
    .passthrough()
    .optional()
    .describe("Optional SHARP or external patient context metadata."),
};

export const getSaferAlternativesOutputSchema = {
  requestId: z.string().uuid(),
  source: z.literal("rules-formulary-llm"),
  analysisProvider: z.enum(["groq", "gemini", "rule-based"]),
  riskLevel: riskLevelSchema,
  proposedMedication: z.string(),
  riskContext: z.array(z.string()),
  alternatives: z.array(
    z.object({
      medication: z.string(),
      therapeuticClass: z.string(),
      safetyScore: z.number().min(0).max(100),
      formularyPreferred: z.boolean(),
      avoidsRisks: z.array(z.string()),
      cautionFlags: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
  summary: z.string(),
  analysisRecommendations: z.array(z.string()),
  generatedAt: z.string(),
};

const inputObjectSchema = z.object(getSaferAlternativesInputSchema);
const outputObjectSchema = z.object(getSaferAlternativesOutputSchema);

export type GetSaferAlternativesInput = z.infer<typeof inputObjectSchema>;

interface GetSaferAlternativesService {
  getSaferAlternatives(
    input: {
      proposedMedication: string;
      currentMedications: string[];
      patientAllergies: string[];
      patientConditions: string[];
      formularyPreferred: string[];
      maxAlternatives: number;
    },
    requestId: string,
  ): Promise<GetSaferAlternativesResult>;
}

interface GetSaferAlternativesDependencies {
  service: GetSaferAlternativesService;
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

function buildResponseText(result: GetSaferAlternativesResult): string {
  const lines = [
    `Risk level: ${result.riskLevel} (analysis: ${result.analysisProvider})`,
    result.summary,
  ];

  if (result.riskContext.length > 0) {
    lines.push(
      "Risk context:",
      ...result.riskContext.map((item, index) => `${index + 1}. ${item}`),
    );
  }

  if (result.alternatives.length > 0) {
    lines.push(
      "Alternatives:",
      ...result.alternatives.map(
        (item, index) =>
          `${index + 1}. ${item.medication} (${item.therapeuticClass}) - score ${item.safetyScore}`,
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
 * Handles MCP execution for safer-alternative ranking with optional SHARP hydration.
 */
export async function executeGetSaferAlternatives(
  args: GetSaferAlternativesInput,
  dependencies: GetSaferAlternativesDependencies,
): Promise<CallToolResult> {
  const requestId = randomUUID();
  const toolLogger = dependencies.logger.child({
    tool: "get_safer_alternatives",
    requestId,
  });

  try {
    const sharpContext = args.sharp_context
      ? toSharpContext(args.sharp_context)
      : undefined;

    const hydratedMedications =
      sharpContext && dependencies.sharpContextService
        ? await dependencies.sharpContextService.resolveMedications(
            sharpContext,
          )
        : [];

    const hydratedAllergies =
      sharpContext && dependencies.sharpContextService
        ? await dependencies.sharpContextService.resolveAllergies(sharpContext)
        : [];

    const hydratedConditions =
      sharpContext && dependencies.sharpContextService
        ? await dependencies.sharpContextService.resolveConditions(sharpContext)
        : [];

    const currentMedications = asUnique([
      ...args.current_medications,
      ...hydratedMedications,
    ]);
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

    toolLogger.info("Running safer alternatives ranking", {
      currentMedicationCount: currentMedications.length,
      allergyCount: patientAllergies.length,
      conditionCount: patientConditions.length,
      formularyCount: args.formulary_preferred.length,
      maxAlternatives: args.max_alternatives,
      hasPatientContext: Boolean(args.patient_context),
      usedSharpContext: Boolean(sharpContext),
      hydratedMedicationCount: hydratedMedications.length,
      hydratedAllergyCount: hydratedAllergies.length,
      hydratedConditionCount: hydratedConditions.length,
    });

    const result = await dependencies.service.getSaferAlternatives(
      {
        proposedMedication: args.proposed_medication,
        currentMedications,
        patientAllergies,
        patientConditions,
        formularyPreferred: args.formulary_preferred,
        maxAlternatives: args.max_alternatives,
      },
      requestId,
    );

    const validatedResult = outputObjectSchema.parse(result);

    toolLogger.info("Safer alternatives ranking completed", {
      riskLevel: validatedResult.riskLevel,
      alternatives: validatedResult.alternatives.length,
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
      "Unable to rank safer medication alternatives.",
    );

    toolLogger.error("Safer alternatives ranking failed", {
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
