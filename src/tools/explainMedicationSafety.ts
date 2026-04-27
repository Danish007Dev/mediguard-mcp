import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toAppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type { DecisionTraceService } from "../services/decisionTraceService";
import { sharpContextSchema, toSharpContext } from "../sharp/sharpContext";
import type { SharpContextDataService } from "../services/sharpContextFhirService";
import type { ExplainMedicationSafetyResult } from "../types/medicationSafety";

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

export const explainMedicationSafetyInputSchema = {
  audience: z
    .enum(["patient", "provider"])
    .default("patient")
    .describe("Target audience for explanation style and depth."),
  language: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .default("en")
    .describe("Preferred explanation language tag (for example: en, es, fr)."),
  medication: z
    .string()
    .trim()
    .min(1, "Medication is required.")
    .describe("Medication name for the safety explanation."),
  risk_level: riskLevelSchema.describe("Overall risk level to explain."),
  findings: z
    .array(
      z.object({
        issue: z.string().trim().min(1),
        severity: z.enum(["minor", "moderate", "major", "contraindicated"]),
        clinical_impact: z.string().trim().min(1),
        recommended_action: z.string().trim().min(1),
      }),
    )
    .max(20)
    .default([])
    .describe(
      "Structured safety findings to translate into explanation output.",
    ),
  recommendations: z
    .array(z.string().trim().min(1))
    .max(20)
    .default([])
    .describe("Action recommendations to include in the explanation."),
  sharp_context: sharpContextSchema
    .optional()
    .describe(
      "Optional SHARP context for auto-fetching meds/allergies from FHIR.",
    ),
  patient_context: z
    .object({})
    .passthrough()
    .optional()
    .describe("Optional SHARP or external patient context metadata."),
};

export const explainMedicationSafetyOutputSchema = {
  requestId: z.string().uuid(),
  source: z.literal("template-llm"),
  analysisProvider: z.enum(["groq", "gemini", "rule-based"]),
  audience: z.enum(["patient", "provider"]),
  language: z.string(),
  readingLevel: z.enum(["grade-8", "clinical"]),
  medication: z.string(),
  riskLevel: riskLevelSchema,
  headline: z.string(),
  explanation: z.string(),
  keyPoints: z.array(z.string()),
  followUpQuestions: z.array(z.string()),
  disclaimer: z.string(),
  llmTrace: llmTraceSchema,
  llmTelemetry: llmTelemetrySchema,
  generatedAt: z.string(),
};

const inputObjectSchema = z.object(explainMedicationSafetyInputSchema);
const outputObjectSchema = z.object(explainMedicationSafetyOutputSchema);

export type ExplainMedicationSafetyInput = z.infer<typeof inputObjectSchema>;

interface ExplainMedicationSafetyService {
  explainMedicationSafety(
    input: {
      audience: "patient" | "provider";
      language: string;
      medication: string;
      riskLevel: "low" | "medium" | "high" | "critical";
      findings: Array<{
        issue: string;
        severity: "minor" | "moderate" | "major" | "contraindicated";
        clinicalImpact: string;
        recommendedAction: string;
      }>;
      recommendations: string[];
    },
    requestId: string,
  ): Promise<ExplainMedicationSafetyResult>;
}

interface ExplainMedicationSafetyDependencies {
  service: ExplainMedicationSafetyService;
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

function medicationMatchesAllergy(
  medication: string,
  allergy: string,
): boolean {
  const med = medication.toLowerCase();
  const al = allergy.toLowerCase();
  return med.includes(al) || al.includes(med);
}

function buildResponseText(result: ExplainMedicationSafetyResult): string {
  const lines = [
    `${result.headline}`,
    `Audience: ${result.audience} (${result.readingLevel})`,
    `Risk level: ${result.riskLevel} (analysis: ${result.analysisProvider})`,
    result.explanation,
  ];

  if (result.keyPoints.length > 0) {
    lines.push(
      "Key points:",
      ...result.keyPoints.map((point, index) => `${index + 1}. ${point}`),
    );
  }

  if (result.followUpQuestions.length > 0) {
    lines.push(
      "Follow-up questions:",
      ...result.followUpQuestions.map(
        (question, index) => `${index + 1}. ${question}`,
      ),
    );
  }

  lines.push(`Disclaimer: ${result.disclaimer}`);

  return lines.join("\n");
}

/**
 * Handles MCP execution for patient/provider-facing medication safety explanations.
 */
export async function executeExplainMedicationSafety(
  args: ExplainMedicationSafetyInput,
  dependencies: ExplainMedicationSafetyDependencies,
): Promise<CallToolResult> {
  const requestId = randomUUID();
  const toolLogger = dependencies.logger.child({
    tool: "explain_medication_safety",
    requestId,
  });

  dependencies.traceService?.startTrace({
    requestId,
    toolName: "explain_medication_safety",
    inputSummary: {
      audience: args.audience,
      language: args.language,
      medication: args.medication,
      riskLevel: args.risk_level,
      findingCount: args.findings.length,
      recommendationCount: args.recommendations.length,
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

    const hydratedAllergies =
      sharpContext && dependencies.sharpContextService
        ? await dependencies.sharpContextService.resolveAllergies(sharpContext)
        : [];

    const findings = args.findings.map((finding) => ({
      issue: finding.issue,
      severity: finding.severity,
      clinicalImpact: finding.clinical_impact,
      recommendedAction: finding.recommended_action,
    }));

    if (
      hydratedAllergies.some((allergy) =>
        medicationMatchesAllergy(args.medication, allergy),
      ) &&
      !findings.some((finding) => finding.severity === "contraindicated")
    ) {
      findings.push({
        issue: "Potential allergy mismatch from SHARP context",
        severity: "major",
        clinicalImpact:
          "FHIR allergy records may conflict with this medication choice.",
        recommendedAction:
          "Verify allergy details and consider a safer alternative if allergy is confirmed.",
      });
    }

    const recommendations = asUnique([
      ...args.recommendations,
      ...(hydratedMedications.length > 0
        ? [
            "Confirm this medication against the patient's active FHIR medication list before prescribing.",
          ]
        : []),
    ]);

    dependencies.traceService?.addStep({
      requestId,
      name: "context_hydration",
      status: "success",
      startedAt: hydrationStepStartedAt,
      finishedAt: Date.now(),
      details: {
        hydratedMedicationCount: hydratedMedications.length,
        hydratedAllergyCount: hydratedAllergies.length,
        finalFindingCount: findings.length,
        finalRecommendationCount: recommendations.length,
      },
    });

    if (sharpContext && dependencies.sharpContextService) {
      dependencies.sharpContextService.propagateContext(sharpContext);
    }

    toolLogger.info("Running medication safety explanation", {
      audience: args.audience,
      language: args.language,
      riskLevel: args.risk_level,
      findingCount: findings.length,
      recommendationCount: recommendations.length,
      hasPatientContext: Boolean(args.patient_context),
      usedSharpContext: Boolean(sharpContext),
      hydratedMedicationCount: hydratedMedications.length,
      hydratedAllergyCount: hydratedAllergies.length,
    });

    const serviceStepStartedAt = Date.now();
    const result = await dependencies.service.explainMedicationSafety(
      {
        audience: args.audience,
        language: args.language,
        medication: args.medication,
        riskLevel: args.risk_level,
        findings,
        recommendations,
      },
      requestId,
    );

    dependencies.traceService?.addStep({
      requestId,
      name: "explanation_generation",
      status: "success",
      startedAt: serviceStepStartedAt,
      finishedAt: Date.now(),
      details: {
        source: result.source,
        analysisProvider: result.analysisProvider,
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
        audience: validatedResult.audience,
        riskLevel: validatedResult.riskLevel,
        keyPointCount: validatedResult.keyPoints.length,
      },
    });

    toolLogger.info("Medication safety explanation completed", {
      audience: validatedResult.audience,
      riskLevel: validatedResult.riskLevel,
      provider: validatedResult.analysisProvider,
    });

    dependencies.traceService?.completeTrace({
      requestId,
      outputSummary: {
        status: "success",
        audience: validatedResult.audience,
        riskLevel: validatedResult.riskLevel,
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
      "Unable to generate medication safety explanation.",
    );

    dependencies.traceService?.failTrace({
      requestId,
      code: appError.code,
      message: appError.message,
    });

    toolLogger.error("Medication safety explanation failed", {
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
