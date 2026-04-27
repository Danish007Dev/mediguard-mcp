import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError, toAppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import { sharpContextSchema, toSharpContext } from "../sharp/sharpContext";
import type { DecisionTraceService } from "../services/decisionTraceService";
import type { SharpContextDataService } from "../services/sharpContextFhirService";
import type { WhatIfSimulationResult } from "../types/medicationSafety";

const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
const gradeSchema = z.enum(["A", "B", "C", "D", "F"]);
const changeActionSchema = z.enum(["add", "remove", "replace"]);
const recommendationSchema = z.enum(["safer", "riskier", "equivalent"]);

export const simulateWhatIfMedicationChangeInputSchema = {
  patient_age: z
    .number()
    .int()
    .min(0, "Patient age cannot be negative.")
    .max(130, "Patient age appears invalid.")
    .optional()
    .describe("Optional patient age for risk-context-aware simulation."),
  patient_conditions: z
    .array(z.string().trim().min(1))
    .max(100, "Maximum 100 conditions supported per request.")
    .default([])
    .describe("Optional patient conditions to enrich simulation context."),
  current_medications: z
    .array(z.string().trim().min(1, "Medication names cannot be empty."))
    .max(75, "Maximum 75 medications supported per request.")
    .default([])
    .describe("Current active medication list for baseline comparison."),
  proposed_change: z
    .object({
      action: changeActionSchema,
      drug: z.string().trim().min(1, "Proposed change drug is required."),
      replacement_drug: z
        .string()
        .trim()
        .min(1, "Replacement drug cannot be empty.")
        .optional(),
    })
    .describe("Medication change action to simulate (add/remove/replace)."),
  sharp_context: sharpContextSchema
    .optional()
    .describe(
      "Optional SHARP context for auto-fetching medications and conditions from FHIR.",
    ),
};

export const simulateWhatIfMedicationChangeOutputSchema = {
  requestId: z.string().uuid(),
  source: z.literal("rules-what-if"),
  analysisProvider: z.enum(["groq", "gemini", "rule-based"]),
  recommendation: recommendationSchema,
  proposedChange: z.object({
    action: changeActionSchema,
    drug: z.string(),
    replacementDrug: z.string().optional(),
  }),
  current: z.object({
    medications: z.array(z.string()),
    score: z.number().int().min(0).max(100),
    grade: gradeSchema,
    riskLevel: riskLevelSchema,
    interactionCount: z.number().int().nonnegative(),
  }),
  proposed: z.object({
    medications: z.array(z.string()),
    score: z.number().int().min(0).max(100),
    grade: gradeSchema,
    riskLevel: riskLevelSchema,
    interactionCount: z.number().int().nonnegative(),
  }),
  delta: z.object({
    scoreDelta: z.number().int(),
    interactionDelta: z.number().int(),
    gradeChanged: z.boolean(),
    riskLevelChanged: z.boolean(),
  }),
  newRisks: z.array(
    z.object({
      drugs: z.array(z.string()),
      severity: z.enum(["minor", "moderate", "major", "contraindicated"]),
      mechanism: z.string(),
      clinicalImpact: z.string(),
      recommendations: z.array(z.string()),
      evidence: z.string(),
    }),
  ),
  resolvedRisks: z.array(
    z.object({
      drugs: z.array(z.string()),
      severity: z.enum(["minor", "moderate", "major", "contraindicated"]),
      mechanism: z.string(),
      clinicalImpact: z.string(),
      recommendations: z.array(z.string()),
      evidence: z.string(),
    }),
  ),
  explanation: z.string(),
  generatedAt: z.string(),
};

const inputObjectSchema = z.object(simulateWhatIfMedicationChangeInputSchema);
const outputObjectSchema = z.object(simulateWhatIfMedicationChangeOutputSchema);

export type SimulateWhatIfMedicationChangeInput = z.infer<
  typeof inputObjectSchema
>;

interface WhatIfSimulationService {
  simulate(
    input: {
      patientAge?: number;
      patientConditions: string[];
      currentMedications: string[];
      proposedChange: {
        action: "add" | "remove" | "replace";
        drug: string;
        replacementDrug?: string;
      };
    },
    requestId: string,
  ): Promise<WhatIfSimulationResult>;
}

interface SimulateWhatIfMedicationChangeDependencies {
  service: WhatIfSimulationService;
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

function buildResponseText(result: WhatIfSimulationResult): string {
  const changeText =
    result.proposedChange.action === "replace"
      ? `replace ${result.proposedChange.drug} with ${result.proposedChange.replacementDrug}`
      : `${result.proposedChange.action} ${result.proposedChange.drug}`;

  return [
    `What-if recommendation: ${result.recommendation} (${changeText})`,
    `Score: ${result.current.score} -> ${result.proposed.score} (delta ${result.delta.scoreDelta > 0 ? `+${result.delta.scoreDelta}` : result.delta.scoreDelta})`,
    `Interactions: ${result.current.interactionCount} -> ${result.proposed.interactionCount} (delta ${result.delta.interactionDelta > 0 ? `+${result.delta.interactionDelta}` : result.delta.interactionDelta})`,
    result.explanation,
  ].join("\n");
}

/**
 * Handles MCP execution for medication what-if simulation with optional SHARP hydration.
 */
export async function executeSimulateWhatIfMedicationChange(
  args: SimulateWhatIfMedicationChangeInput,
  dependencies: SimulateWhatIfMedicationChangeDependencies,
): Promise<CallToolResult> {
  const requestId = randomUUID();
  const toolLogger = dependencies.logger.child({
    tool: "simulate_medication_change",
    requestId,
  });

  dependencies.traceService?.startTrace({
    requestId,
    toolName: "simulate_medication_change",
    inputSummary: {
      action: args.proposed_change.action,
      medicationCount: args.current_medications.length,
      patientConditionCount: args.patient_conditions.length,
      hasSharpContext: Boolean(args.sharp_context),
      isReplaceAction: args.proposed_change.action === "replace",
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

    if (
      args.proposed_change.action === "replace" &&
      !args.proposed_change.replacement_drug
    ) {
      throw new AppError(
        "replacement_drug is required when proposed_change.action is 'replace'.",
        "VALIDATION_ERROR",
      );
    }

    if (sharpContext && dependencies.sharpContextService) {
      dependencies.sharpContextService.propagateContext(sharpContext);
    }

    toolLogger.info("Running what-if simulation", {
      currentMedicationCount: currentMedications.length,
      action: args.proposed_change.action,
      drug: args.proposed_change.drug,
      replacementDrug: args.proposed_change.replacement_drug,
      patientAge: args.patient_age,
      usedSharpContext: Boolean(sharpContext),
      hydratedMedicationCount: hydratedMedications.length,
      hydratedConditionCount: hydratedConditions.length,
    });

    const serviceStepStartedAt = Date.now();
    const result = await dependencies.service.simulate(
      {
        patientAge: args.patient_age,
        patientConditions,
        currentMedications,
        proposedChange: {
          action: args.proposed_change.action,
          drug: args.proposed_change.drug,
          replacementDrug: args.proposed_change.replacement_drug,
        },
      },
      requestId,
    );

    dependencies.traceService?.addStep({
      requestId,
      name: "what_if_analysis",
      status: "success",
      startedAt: serviceStepStartedAt,
      finishedAt: Date.now(),
      details: {
        recommendation: result.recommendation,
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
        recommendation: validatedResult.recommendation,
        scoreDelta: validatedResult.delta.scoreDelta,
        interactionDelta: validatedResult.delta.interactionDelta,
      },
    });

    toolLogger.info("What-if simulation completed", {
      recommendation: validatedResult.recommendation,
      scoreDelta: validatedResult.delta.scoreDelta,
      interactionDelta: validatedResult.delta.interactionDelta,
    });

    dependencies.traceService?.completeTrace({
      requestId,
      outputSummary: {
        status: "success",
        recommendation: validatedResult.recommendation,
        scoreDelta: validatedResult.delta.scoreDelta,
        interactionDelta: validatedResult.delta.interactionDelta,
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
    const appError = toAppError(error, "Unable to simulate medication change.");

    dependencies.traceService?.failTrace({
      requestId,
      code: appError.code,
      message: appError.message,
    });

    toolLogger.error("What-if simulation failed", {
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
