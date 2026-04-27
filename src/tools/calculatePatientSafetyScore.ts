import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError, toAppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import { sharpContextSchema, toSharpContext } from "../sharp/sharpContext";
import type { DecisionTraceService } from "../services/decisionTraceService";
import type { SharpContextDataService } from "../services/sharpContextFhirService";
import type {
  PatientSafetyDashboardArtifact,
  PatientSafetyScoreResult,
} from "../types/medicationSafety";

const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export const calculatePatientSafetyScoreInputSchema = {
  patient_age: z
    .number()
    .int()
    .min(0, "Patient age cannot be negative.")
    .max(130, "Patient age appears invalid.")
    .optional()
    .describe("Optional patient age used for Beers-style risk scoring."),
  patient_conditions: z
    .array(z.string().trim().min(1))
    .max(100, "Maximum 100 conditions supported per request.")
    .default([])
    .describe("Optional patient conditions to enrich context for scoring."),
  current_medications: z
    .array(z.string().trim().min(1, "Medication names cannot be empty."))
    .max(75, "Maximum 75 medications supported per request.")
    .default([])
    .describe("Current active medication list to score for safety risk."),
  sharp_context: sharpContextSchema
    .optional()
    .describe(
      "Optional SHARP context for auto-fetching medications and conditions from FHIR.",
    ),
};

export const calculatePatientSafetyScoreOutputSchema = {
  requestId: z.string().uuid(),
  source: z.literal("rules-interactions"),
  analysisProvider: z.enum(["groq", "gemini", "rule-based"]),
  riskLevel: riskLevelSchema,
  score: z.number().int().min(0).max(100),
  grade: z.enum(["A", "B", "C", "D", "F"]),
  medicationCount: z.number().int().positive(),
  deductionTotal: z.number().int().nonnegative(),
  deductions: z.array(
    z.object({
      category: z.string(),
      points: z.number().int().nonnegative(),
      rationale: z.string(),
    }),
  ),
  interactionSummary: z.object({
    contraindicated: z.number().int().nonnegative(),
    major: z.number().int().nonnegative(),
    moderate: z.number().int().nonnegative(),
    minor: z.number().int().nonnegative(),
  }),
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
  improvementOpportunities: z.array(
    z.object({
      title: z.string(),
      action: z.string(),
      expectedPointsGain: z.number().int().nonnegative(),
    }),
  ),
  potentialOptimizedScore: z.number().int().min(0).max(100),
  dashboardArtifact: z.object({
    version: z.literal("1.0.0"),
    generatedAt: z.string(),
    scoreCard: z.object({
      score: z.number().int().min(0).max(100),
      grade: z.enum(["A", "B", "C", "D", "F"]),
      riskLevel: riskLevelSchema,
      potentialOptimizedScore: z.number().int().min(0).max(100),
      optimizationGap: z.number().int().min(0).max(100),
      medicationCount: z.number().int().positive(),
    }),
    severityChart: z.array(
      z.object({
        severity: z.enum(["minor", "moderate", "major", "contraindicated"]),
        count: z.number().int().nonnegative(),
      }),
    ),
    deductionBreakdown: z.array(
      z.object({
        category: z.string(),
        points: z.number().int().nonnegative(),
        rationale: z.string(),
      }),
    ),
    opportunityQueue: z.array(
      z.object({
        title: z.string(),
        action: z.string(),
        expectedPointsGain: z.number().int().nonnegative(),
      }),
    ),
    flagsPanel: z.object({
      beersFlagCount: z.number().int().nonnegative(),
      duplicateClassCount: z.number().int().nonnegative(),
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
    }),
  }),
  summary: z.string(),
  generatedAt: z.string(),
};

const inputObjectSchema = z.object(calculatePatientSafetyScoreInputSchema);
const outputObjectSchema = z.object(calculatePatientSafetyScoreOutputSchema);

export type CalculatePatientSafetyScoreInput = z.infer<typeof inputObjectSchema>;

interface PatientSafetyScoreService {
  calculateSafetyScore(
    input: {
      patientAge?: number;
      patientConditions: string[];
      currentMedications: string[];
    },
    requestId: string,
  ): Promise<PatientSafetyScoreResult>;
}

interface CalculatePatientSafetyScoreDependencies {
  service: PatientSafetyScoreService;
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

function buildResponseText(result: PatientSafetyScoreResult): string {
  const lines = [
    `Patient safety score: ${result.score}/100 (grade ${result.grade}, risk ${result.riskLevel})`,
    `Medication count: ${result.medicationCount}`,
    `Total deductions: ${result.deductionTotal}`,
    result.summary,
  ];

  if (result.improvementOpportunities.length > 0) {
    lines.push(
      "Improvement opportunities:",
      ...result.improvementOpportunities.map(
        (item, index) =>
          `${index + 1}. ${item.title} (+${item.expectedPointsGain}) - ${item.action}`,
      ),
    );
  }

  lines.push(`Potential optimized score: ${result.potentialOptimizedScore}/100`);

  return lines.join("\n");
}

function buildDashboardArtifact(
  result: PatientSafetyScoreResult,
): PatientSafetyDashboardArtifact {
  return {
    version: "1.0.0",
    generatedAt: result.generatedAt,
    scoreCard: {
      score: result.score,
      grade: result.grade,
      riskLevel: result.riskLevel,
      potentialOptimizedScore: result.potentialOptimizedScore,
      optimizationGap: Math.max(0, result.potentialOptimizedScore - result.score),
      medicationCount: result.medicationCount,
    },
    severityChart: [
      {
        severity: "contraindicated",
        count: result.interactionSummary.contraindicated,
      },
      {
        severity: "major",
        count: result.interactionSummary.major,
      },
      {
        severity: "moderate",
        count: result.interactionSummary.moderate,
      },
      {
        severity: "minor",
        count: result.interactionSummary.minor,
      },
    ],
    deductionBreakdown: [...result.deductions].sort(
      (left, right) => right.points - left.points,
    ),
    opportunityQueue: [...result.improvementOpportunities].sort(
      (left, right) => right.expectedPointsGain - left.expectedPointsGain,
    ),
    flagsPanel: {
      beersFlagCount: result.beersFlags.length,
      duplicateClassCount: result.duplicateTherapeuticClasses.length,
      beersFlags: result.beersFlags,
      duplicateTherapeuticClasses: result.duplicateTherapeuticClasses,
    },
  };
}

/**
 * Handles MCP execution for patient safety score calculation with optional SHARP hydration.
 */
export async function executeCalculatePatientSafetyScore(
  args: CalculatePatientSafetyScoreInput,
  dependencies: CalculatePatientSafetyScoreDependencies,
): Promise<CallToolResult> {
  const requestId = randomUUID();
  const toolLogger = dependencies.logger.child({
    tool: "calculate_patient_safety_score",
    requestId,
  });

  dependencies.traceService?.startTrace({
    requestId,
    toolName: "calculate_patient_safety_score",
    inputSummary: {
      medicationCount: args.current_medications.length,
      hasSharpContext: Boolean(args.sharp_context),
      hasPatientAge: typeof args.patient_age === "number",
      patientConditionCount: args.patient_conditions.length,
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

    toolLogger.info("Running patient safety score calculation", {
      medicationCount: currentMedications.length,
      patientAge: args.patient_age,
      usedSharpContext: Boolean(sharpContext),
      hydratedMedicationCount: hydratedMedications.length,
      hydratedConditionCount: hydratedConditions.length,
    });

    const serviceStepStartedAt = Date.now();
    const result = await dependencies.service.calculateSafetyScore(
      {
        patientAge: args.patient_age,
        patientConditions,
        currentMedications,
      },
      requestId,
    );

    dependencies.traceService?.addStep({
      requestId,
      name: "safety_score_analysis",
      status: "success",
      startedAt: serviceStepStartedAt,
      finishedAt: Date.now(),
      details: {
        source: result.source,
        analysisProvider: result.analysisProvider,
      },
    });

    const validationStepStartedAt = Date.now();
    const validatedResult = outputObjectSchema.parse({
      ...result,
      dashboardArtifact: buildDashboardArtifact(result),
    });

    dependencies.traceService?.addStep({
      requestId,
      name: "output_validation",
      status: "success",
      startedAt: validationStepStartedAt,
      finishedAt: Date.now(),
      details: {
        score: validatedResult.score,
        grade: validatedResult.grade,
        riskLevel: validatedResult.riskLevel,
      },
    });

    toolLogger.info("Patient safety score calculation completed", {
      score: validatedResult.score,
      grade: validatedResult.grade,
      riskLevel: validatedResult.riskLevel,
    });

    dependencies.traceService?.completeTrace({
      requestId,
      outputSummary: {
        status: "success",
        score: validatedResult.score,
        grade: validatedResult.grade,
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
      "Unable to calculate patient safety score.",
    );

    dependencies.traceService?.failTrace({
      requestId,
      code: appError.code,
      message: appError.message,
    });

    toolLogger.error("Patient safety score calculation failed", {
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
