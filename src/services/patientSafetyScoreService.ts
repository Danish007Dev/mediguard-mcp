import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type { DrugInteractionService } from "./drugInteractionService";
import type {
  BeersCriteriaFlag,
  DuplicateTherapeuticClassFlag,
  InteractionFinding,
  PatientSafetyScoreResult,
  RiskLevel,
  SafetyScoreDeduction,
  SafetyScoreImprovementOpportunity,
} from "../types/medicationSafety";

export interface CalculatePatientSafetyScoreInput {
  patientAge?: number;
  patientConditions: string[];
  currentMedications: string[];
}

interface MedicationClassDefinition {
  className: string;
  keywords: string[];
  risk: "low" | "medium" | "high";
  rationale: string;
}

interface BeersDefinition {
  keywords: string[];
  reason: string;
  severity: "moderate" | "major";
  evidence: string;
}

const DUPLICATE_CLASS_DEFINITIONS: MedicationClassDefinition[] = [
  {
    className: "NSAIDs",
    keywords: ["ibuprofen", "naproxen", "diclofenac", "ketorolac"],
    risk: "medium",
    rationale:
      "Duplicate NSAID exposure increases gastrointestinal bleeding and renal injury risk.",
  },
  {
    className: "Benzodiazepines",
    keywords: ["diazepam", "lorazepam", "alprazolam", "clonazepam"],
    risk: "high",
    rationale:
      "Concurrent benzodiazepines increase sedation, delirium, and fall risk.",
  },
  {
    className: "ACE/ARB overlap",
    keywords: ["lisinopril", "enalapril", "losartan", "valsartan"],
    risk: "high",
    rationale:
      "Dual RAAS blockade increases hypotension, hyperkalemia, and kidney injury risk.",
  },
];

const BEERS_DEFINITIONS: BeersDefinition[] = [
  {
    keywords: ["diphenhydramine", "hydroxyzine", "promethazine"],
    reason:
      "Strong anticholinergic effects increase confusion and fall risk in older adults.",
    severity: "major",
    evidence:
      "2023 AGS Beers Criteria: avoid first-generation antihistamines in older adults.",
  },
  {
    keywords: ["diazepam", "lorazepam", "alprazolam", "clonazepam"],
    reason:
      "Benzodiazepines can increase sedation, cognitive impairment, and falls in older adults.",
    severity: "major",
    evidence:
      "2023 AGS Beers Criteria: avoid benzodiazepines when possible in older adults.",
  },
  {
    keywords: ["glyburide"],
    reason:
      "Long-acting sulfonylureas can cause prolonged hypoglycemia in older adults.",
    severity: "moderate",
    evidence: "2023 AGS Beers Criteria: avoid glyburide in older adults.",
  },
];

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function toSlug(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function asUnique(values: string[]): string[] {
  const unique = new Map<string, string>();

  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
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

function matchesMedication(medication: string, keywords: string[]): boolean {
  const normalized = toSlug(medication);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function scoreToGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) {
    return "A";
  }

  if (score >= 75) {
    return "B";
  }

  if (score >= 60) {
    return "C";
  }

  if (score >= 45) {
    return "D";
  }

  return "F";
}

function scoreToRiskLevel(
  score: number,
  contraindicatedCount: number,
): RiskLevel {
  if (contraindicatedCount > 0 || score < 60) {
    return "critical";
  }

  if (score < 75) {
    return "high";
  }

  if (score < 90) {
    return "medium";
  }

  return "low";
}

function pointsForInteractionSeverity(
  severity: InteractionFinding["severity"],
): number {
  if (severity === "contraindicated") {
    return 25;
  }

  if (severity === "major") {
    return 15;
  }

  if (severity === "moderate") {
    return 5;
  }

  return 0;
}

/**
 * Computes a quantified patient safety score from interactions and rule-based risk deductions.
 */
export class PatientSafetyScoreService {
  public constructor(
    private readonly logger: Logger,
    private readonly interactionService: DrugInteractionService,
  ) {}

  public async calculateSafetyScore(
    input: CalculatePatientSafetyScoreInput,
    requestId: string,
  ): Promise<PatientSafetyScoreResult> {
    const medications = asUnique(input.currentMedications);
    const conditions = asUnique(input.patientConditions);
    const isElderly = (input.patientAge ?? 0) >= 65;

    if (medications.length === 0) {
      throw new AppError(
        "At least one current medication is required for safety score calculation.",
        "VALIDATION_ERROR",
      );
    }

    const interactionResult =
      await this.interactionService.checkDrugInteractions(
        medications,
        requestId,
        {
          age: input.patientAge,
          conditions,
        },
      );

    const contraindicatedCount = interactionResult.interactions.filter(
      (finding) => finding.severity === "contraindicated",
    ).length;
    const majorCount = interactionResult.interactions.filter(
      (finding) => finding.severity === "major",
    ).length;
    const moderateCount = interactionResult.interactions.filter(
      (finding) => finding.severity === "moderate",
    ).length;
    const minorCount = interactionResult.interactions.filter(
      (finding) => finding.severity === "minor",
    ).length;

    const deductions: SafetyScoreDeduction[] = [];

    const interactionPoints = interactionResult.interactions.reduce(
      (total, interaction) =>
        total + pointsForInteractionSeverity(interaction.severity),
      0,
    );

    if (interactionPoints > 0) {
      deductions.push({
        category: "Drug interactions",
        points: interactionPoints,
        rationale:
          "Interaction severity deductions applied (contraindicated/major/moderate findings).",
      });
    }

    const polypharmacyPoints =
      medications.length > 10 ? (medications.length - 10) * 2 : 0;
    if (polypharmacyPoints > 0) {
      deductions.push({
        category: "Polypharmacy burden",
        points: polypharmacyPoints,
        rationale:
          "Medication count above 10 increases regimen complexity and adverse event risk.",
      });
    }

    const beersFlags = isElderly ? this.getBeersFlags(medications) : [];
    const beersPoints = beersFlags.length * 10;
    if (beersPoints > 0) {
      deductions.push({
        category: "Beers criteria flags",
        points: beersPoints,
        rationale:
          "Potentially inappropriate medications detected for older-adult safety profiles.",
      });
    }

    const duplicateTherapeuticClasses =
      this.getDuplicateTherapeuticClassFlags(medications);
    const duplicatePoints = duplicateTherapeuticClasses.length * 5;
    if (duplicatePoints > 0) {
      deductions.push({
        category: "Duplicate therapeutic classes",
        points: duplicatePoints,
        rationale:
          "Therapeutic overlap can increase toxicity without clear additional benefit.",
      });
    }

    const deductionTotal = deductions.reduce(
      (total, deduction) => total + deduction.points,
      0,
    );

    const score = Math.max(0, 100 - deductionTotal);
    const grade = scoreToGrade(score);
    const riskLevel = scoreToRiskLevel(score, contraindicatedCount);

    const improvementOpportunities = this.getImprovementOpportunities({
      interactionResult,
      beersFlags,
      duplicateTherapeuticClasses,
      polypharmacyPoints,
    });

    const potentialOptimizedScore = Math.min(
      100,
      score +
        improvementOpportunities.reduce(
          (total, opportunity) => total + opportunity.expectedPointsGain,
          0,
        ),
    );

    const summary =
      `Patient safety score: ${score}/100 (grade ${grade}). ` +
      `${contraindicatedCount} contraindicated, ${majorCount} major, and ${moderateCount} moderate interaction findings were detected.`;

    this.logger.info("Patient safety score calculated", {
      requestId,
      score,
      grade,
      deductionTotal,
      medicationCount: medications.length,
      provider: interactionResult.analysisProvider,
    });

    return {
      requestId,
      source: "rules-interactions",
      analysisProvider: interactionResult.analysisProvider,
      riskLevel,
      score,
      grade,
      medicationCount: medications.length,
      deductionTotal,
      deductions,
      interactionSummary: {
        contraindicated: contraindicatedCount,
        major: majorCount,
        moderate: moderateCount,
        minor: minorCount,
      },
      beersFlags,
      duplicateTherapeuticClasses,
      improvementOpportunities,
      potentialOptimizedScore,
      summary,
      generatedAt: new Date().toISOString(),
    };
  }

  private getBeersFlags(medications: string[]): BeersCriteriaFlag[] {
    const flags: BeersCriteriaFlag[] = [];

    for (const medication of medications) {
      for (const definition of BEERS_DEFINITIONS) {
        if (!matchesMedication(medication, definition.keywords)) {
          continue;
        }

        flags.push({
          medication,
          reason: definition.reason,
          severity: definition.severity,
          evidence: definition.evidence,
        });
      }
    }

    return flags;
  }

  private getDuplicateTherapeuticClassFlags(
    medications: string[],
  ): DuplicateTherapeuticClassFlag[] {
    const grouped = new Map<
      string,
      { medications: string[]; definition: MedicationClassDefinition }
    >();

    for (const medication of medications) {
      for (const definition of DUPLICATE_CLASS_DEFINITIONS) {
        if (!matchesMedication(medication, definition.keywords)) {
          continue;
        }

        const existing = grouped.get(definition.className);
        if (!existing) {
          grouped.set(definition.className, {
            medications: [medication],
            definition,
          });
        } else {
          existing.medications.push(medication);
        }
      }
    }

    const flags: DuplicateTherapeuticClassFlag[] = [];

    for (const [className, group] of grouped.entries()) {
      const uniqueMeds = asUnique(group.medications);
      if (uniqueMeds.length < 2) {
        continue;
      }

      flags.push({
        className,
        medications: uniqueMeds,
        risk: group.definition.risk,
        rationale: group.definition.rationale,
      });
    }

    return flags;
  }

  private getImprovementOpportunities(params: {
    interactionResult: Awaited<
      ReturnType<DrugInteractionService["checkDrugInteractions"]>
    >;
    beersFlags: BeersCriteriaFlag[];
    duplicateTherapeuticClasses: DuplicateTherapeuticClassFlag[];
    polypharmacyPoints: number;
  }): SafetyScoreImprovementOpportunity[] {
    const opportunities: SafetyScoreImprovementOpportunity[] = [];

    const interactionFindings = params.interactionResult.interactions.filter(
      (finding) => finding.severity !== "minor",
    );

    if (interactionFindings.length > 0) {
      const recommendation =
        interactionFindings[0]?.recommendations[0] ??
        "Review high-risk combinations and adjust treatment where feasible.";
      const expectedPointsGain = interactionFindings.reduce(
        (total, finding) =>
          total + pointsForInteractionSeverity(finding.severity),
        0,
      );

      opportunities.push({
        title: "Mitigate high-severity interactions",
        action: recommendation,
        expectedPointsGain,
      });
    }

    if (params.beersFlags.length > 0) {
      opportunities.push({
        title: "Replace Beers-flagged medications",
        action:
          "Review flagged older-adult risks and switch to lower-risk alternatives.",
        expectedPointsGain: params.beersFlags.length * 10,
      });
    }

    if (params.duplicateTherapeuticClasses.length > 0) {
      const firstDuplicate = params.duplicateTherapeuticClasses[0];
      opportunities.push({
        title: "De-duplicate therapeutic overlap",
        action: firstDuplicate
          ? `Consolidate ${firstDuplicate.className} agents when clinically appropriate.`
          : "Consolidate duplicate therapeutic classes.",
        expectedPointsGain: params.duplicateTherapeuticClasses.length * 5,
      });
    }

    if (params.polypharmacyPoints > 0) {
      opportunities.push({
        title: "Deprescribe low-value medications",
        action:
          "Review regimen complexity and deprescribe non-essential medications.",
        expectedPointsGain: params.polypharmacyPoints,
      });
    }

    return opportunities;
  }
}
