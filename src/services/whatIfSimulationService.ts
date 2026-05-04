import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type { DrugInteractionService } from "./drugInteractionService";
import type {
  InteractionFinding,
  WhatIfProposedChange,
  WhatIfSimulationResult,
} from "../types/medicationSafety";
import type { CalculatePatientSafetyScoreInput } from "./patientSafetyScoreService";
import type { PatientSafetyScoreService } from "./patientSafetyScoreService";

export interface SimulateWhatIfInput {
  patientAge?: number;
  patientConditions: string[];
  currentMedications: string[];
  proposedChange: WhatIfProposedChange;
}

function asUnique(values: string[]): string[] {
  const unique = new Map<string, string>();

  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, cleaned);
    }
  }

  return Array.from(unique.values());
}

function toInteractionKey(interaction: InteractionFinding): string {
  return [...interaction.drugs]
    .map((item) => item.trim().toLowerCase())
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function applyProposedChange(
  currentMedications: string[],
  proposedChange: WhatIfProposedChange,
): string[] {
  const action = proposedChange.action;
  const sourceDrug = proposedChange.drug.trim();
  const sourceDrugKey = sourceDrug.toLowerCase();

  if (!sourceDrug) {
    throw new AppError("Proposed change drug is required.", "VALIDATION_ERROR");
  }

  const existing = new Map(
    currentMedications.map((medication) => [
      medication.toLowerCase(),
      medication,
    ]),
  );

  if (action === "add") {
    if (existing.has(sourceDrugKey)) {
      return currentMedications;
    }

    return [...currentMedications, sourceDrug];
  }

  if (action === "remove") {
    if (!existing.has(sourceDrugKey)) {
      throw new AppError(
        `Cannot remove '${sourceDrug}' because it is not in current medications.`,
        "VALIDATION_ERROR",
      );
    }

    return currentMedications.filter(
      (medication) => medication.toLowerCase() !== sourceDrugKey,
    );
  }

  const replacementDrug = proposedChange.replacementDrug?.trim() ?? "";
  const replacementKey = replacementDrug.toLowerCase();

  if (!replacementDrug) {
    throw new AppError(
      "replacementDrug is required when action is 'replace'.",
      "VALIDATION_ERROR",
    );
  }

  if (!existing.has(sourceDrugKey)) {
    throw new AppError(
      `Cannot replace '${sourceDrug}' because it is not in current medications.`,
      "VALIDATION_ERROR",
    );
  }

  if (sourceDrugKey === replacementKey) {
    throw new AppError(
      "replacementDrug must be different from drug for replace action.",
      "VALIDATION_ERROR",
    );
  }

  const replaced = currentMedications.map((medication) =>
    medication.toLowerCase() === sourceDrugKey ? replacementDrug : medication,
  );

  return asUnique(replaced);
}

function buildExplanation(params: {
  recommendation: "safer" | "riskier" | "equivalent";
  scoreDelta: number;
  currentScore: number;
  proposedScore: number;
  currentInteractions: number;
  proposedInteractions: number;
  newRisks: InteractionFinding[];
  resolvedRisks: InteractionFinding[];
}): string {
  const directionLabel =
    params.recommendation === "safer"
      ? "safer"
      : params.recommendation === "riskier"
        ? "riskier"
        : "roughly equivalent";

  const scoreDeltaLabel =
    params.scoreDelta > 0
      ? `+${params.scoreDelta}`
      : params.scoreDelta < 0
        ? `${params.scoreDelta}`
        : "0";

  const base =
    `Proposed change is ${directionLabel}: score ${scoreDeltaLabel} ` +
    `(${params.currentScore} -> ${params.proposedScore}) and interactions ` +
    `${params.currentInteractions} -> ${params.proposedInteractions}.`;

  const resolved =
    params.resolvedRisks.length > 0
      ? ` Resolved risks: ${params.resolvedRisks
          .slice(0, 3)
          .map((item) => item.drugs.join(" + "))
          .join("; ")}.`
      : "";

  const introduced =
    params.newRisks.length > 0
      ? ` New risks introduced: ${params.newRisks
          .slice(0, 3)
          .map((item) => item.drugs.join(" + "))
          .join("; ")}.`
      : "";

  return `${base}${resolved}${introduced}`.trim();
}

/**
 * Simulates a medication add/remove/replace operation and compares safety before vs after.
 */
export class WhatIfSimulationService {
  public constructor(
    private readonly logger: Logger,
    private readonly interactionService: DrugInteractionService,
    private readonly patientSafetyScoreService: PatientSafetyScoreService,
  ) {}

  public async simulate(
    input: SimulateWhatIfInput,
    requestId: string,
  ): Promise<WhatIfSimulationResult> {
    const currentMedications = asUnique(input.currentMedications);
    const patientConditions = asUnique(input.patientConditions);

    if (currentMedications.length === 0) {
      throw new AppError(
        "At least one current medication is required for what-if simulation.",
        "VALIDATION_ERROR",
      );
    }

    const proposedMedications = applyProposedChange(
      currentMedications,
      input.proposedChange,
    );

    const scoreInputBase: Omit<
      CalculatePatientSafetyScoreInput,
      "currentMedications"
    > = {
      patientAge: input.patientAge,
      patientConditions,
    };

    const [
      currentScore,
      proposedScore,
      currentInteractions,
      proposedInteractions,
    ] = await Promise.all([
      this.patientSafetyScoreService.calculateSafetyScore(
        {
          ...scoreInputBase,
          currentMedications,
        },
        `${requestId}-current-score`,
      ),
      this.patientSafetyScoreService.calculateSafetyScore(
        {
          ...scoreInputBase,
          currentMedications: proposedMedications,
        },
        `${requestId}-proposed-score`,
      ),
      this.interactionService.checkDrugInteractions(
        currentMedications,
        `${requestId}-current-risks`,
        {
          age: input.patientAge,
          conditions: patientConditions,
        },
      ),
      this.interactionService.checkDrugInteractions(
        proposedMedications,
        `${requestId}-proposed-risks`,
        {
          age: input.patientAge,
          conditions: patientConditions,
        },
      ),
    ]);

    const currentRiskMap = new Map(
      currentInteractions.interactions.map((item) => [
        toInteractionKey(item),
        item,
      ]),
    );

    const proposedRiskMap = new Map(
      proposedInteractions.interactions.map((item) => [
        toInteractionKey(item),
        item,
      ]),
    );

    const newRisks = proposedInteractions.interactions.filter(
      (item) => !currentRiskMap.has(toInteractionKey(item)),
    );

    const resolvedRisks = currentInteractions.interactions.filter(
      (item) => !proposedRiskMap.has(toInteractionKey(item)),
    );

    const scoreDelta = proposedScore.score - currentScore.score;
    const interactionDelta =
      proposedInteractions.interactions.length -
      currentInteractions.interactions.length;

    const recommendation =
      scoreDelta > 0 || (scoreDelta === 0 && interactionDelta < 0)
        ? "safer"
        : scoreDelta < 0 || (scoreDelta === 0 && interactionDelta > 0)
          ? "riskier"
          : "equivalent";

    const result: WhatIfSimulationResult = {
      requestId,
      source: "rules-what-if",
      analysisProvider: proposedScore.analysisProvider,
      recommendation,
      proposedChange: input.proposedChange,
      current: {
        medications: currentMedications,
        score: currentScore.score,
        grade: currentScore.grade,
        riskLevel: currentScore.riskLevel,
        interactionCount: currentInteractions.interactions.length,
      },
      proposed: {
        medications: proposedMedications,
        score: proposedScore.score,
        grade: proposedScore.grade,
        riskLevel: proposedScore.riskLevel,
        interactionCount: proposedInteractions.interactions.length,
      },
      delta: {
        scoreDelta,
        interactionDelta,
        gradeChanged: currentScore.grade !== proposedScore.grade,
        riskLevelChanged: currentScore.riskLevel !== proposedScore.riskLevel,
      },
      newRisks,
      resolvedRisks,
      explanation: buildExplanation({
        recommendation,
        scoreDelta,
        currentScore: currentScore.score,
        proposedScore: proposedScore.score,
        currentInteractions: currentInteractions.interactions.length,
        proposedInteractions: proposedInteractions.interactions.length,
        newRisks,
        resolvedRisks,
      }),
      generatedAt: new Date().toISOString(),
    };

    this.logger.info("What-if simulation completed", {
      requestId,
      action: input.proposedChange.action,
      recommendation,
      scoreDelta: result.delta.scoreDelta,
      interactionDelta: result.delta.interactionDelta,
      currentScore: result.current.score,
      proposedScore: result.proposed.score,
    });

    return result;
  }
}
