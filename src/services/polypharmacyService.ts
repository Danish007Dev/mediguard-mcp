import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type {
  AnalyzePolypharmacyResult,
  BeersCriteriaFlag,
  DeprescribingOpportunity,
  DuplicateTherapeuticClassFlag,
  RiskLevel,
} from "../types/medicationSafety";
import {
  RuleOnlyPolypharmacySynthesisService,
  type PolypharmacySynthesisInput,
  type PolypharmacySynthesisResult,
} from "./polypharmacySynthesisService";

export interface AnalyzePolypharmacyInput {
  patientAge: number;
  patientConditions: string[];
  currentMedications: string[];
}

type PolypharmacySynthesisEngine = {
  synthesize(
    input: PolypharmacySynthesisInput,
  ): Promise<PolypharmacySynthesisResult>;
};

interface MedicationClassDefinition {
  className: string;
  keywords: string[];
  riskIfDuplicate: "low" | "medium" | "high";
  rationale: string;
}

interface BeersDefinition {
  keywords: string[];
  reason: string;
  severity: "moderate" | "major";
  evidence: string;
  suggestedAlternative?: string;
}

interface BurdenDefinition {
  keywords: string[];
  weight: number;
}

const MEDICATION_CLASS_DEFINITIONS: MedicationClassDefinition[] = [
  {
    className: "NSAIDs",
    keywords: [
      "ibuprofen",
      "naproxen",
      "diclofenac",
      "indomethacin",
      "ketorolac",
    ],
    riskIfDuplicate: "medium",
    rationale:
      "Duplicate NSAID therapy increases gastrointestinal, renal, and bleeding risk.",
  },
  {
    className: "Benzodiazepines",
    keywords: [
      "diazepam",
      "lorazepam",
      "alprazolam",
      "clonazepam",
      "temazepam",
    ],
    riskIfDuplicate: "high",
    rationale:
      "Duplicate benzodiazepines increase oversedation, confusion, and fall risk.",
  },
  {
    className: "Opioids",
    keywords: ["morphine", "oxycodone", "hydrocodone", "tramadol", "fentanyl"],
    riskIfDuplicate: "high",
    rationale:
      "Concurrent opioid therapies increase respiratory depression and overdose risk.",
  },
  {
    className: "Antihistamines (First Generation)",
    keywords: [
      "diphenhydramine",
      "hydroxyzine",
      "chlorpheniramine",
      "promethazine",
    ],
    riskIfDuplicate: "high",
    rationale:
      "Combined anticholinergic burden increases confusion and delirium risk.",
  },
  {
    className: "Antidepressants (TCA)",
    keywords: ["amitriptyline", "nortriptyline", "imipramine", "doxepin"],
    riskIfDuplicate: "high",
    rationale:
      "Duplicate tricyclic antidepressants can increase anticholinergic and arrhythmia risk.",
  },
  {
    className: "Sulfonylureas",
    keywords: ["glyburide", "glimepiride", "glipizide"],
    riskIfDuplicate: "medium",
    rationale: "Overlapping sulfonylureas increase hypoglycemia risk.",
  },
];

const BEERS_DEFINITIONS: BeersDefinition[] = [
  {
    keywords: ["diphenhydramine", "hydroxyzine", "promethazine"],
    reason:
      "Strong anticholinergic effects can increase confusion, delirium, and fall risk in older adults.",
    severity: "major",
    evidence:
      "2023 AGS Beers Criteria: avoid first-generation antihistamines in older adults.",
    suggestedAlternative:
      "Consider second-generation antihistamines or non-pharmacologic sleep strategies.",
  },
  {
    keywords: ["diazepam", "lorazepam", "alprazolam", "clonazepam"],
    reason:
      "Increased sensitivity in older adults can lead to sedation, cognitive impairment, and falls.",
    severity: "major",
    evidence:
      "2023 AGS Beers Criteria: avoid benzodiazepines when possible in older adults.",
    suggestedAlternative:
      "Consider non-pharmacologic anxiety/sleep management or safer short-term options.",
  },
  {
    keywords: ["zolpidem", "eszopiclone", "zaleplon"],
    reason:
      "Z-drugs have adverse events similar to benzodiazepines, including delirium and falls.",
    severity: "major",
    evidence:
      "2023 AGS Beers Criteria: avoid non-benzodiazepine hypnotics in older adults.",
    suggestedAlternative:
      "Consider sleep hygiene and cognitive behavioral therapy for insomnia.",
  },
  {
    keywords: ["amitriptyline", "doxepin", "imipramine"],
    reason:
      "Tricyclic antidepressants have high anticholinergic and orthostatic hypotension risk.",
    severity: "major",
    evidence:
      "2023 AGS Beers Criteria: avoid tertiary tricyclic antidepressants in older adults.",
    suggestedAlternative:
      "Consider lower-risk antidepressants based on clinical indication.",
  },
  {
    keywords: ["glyburide"],
    reason:
      "Long-acting sulfonylureas can cause prolonged hypoglycemia in older adults.",
    severity: "moderate",
    evidence: "2023 AGS Beers Criteria: avoid glyburide in older adults.",
    suggestedAlternative:
      "Consider shorter-acting or non-sulfonylurea glucose-lowering therapy.",
  },
  {
    keywords: ["cyclobenzaprine"],
    reason:
      "Skeletal muscle relaxants have anticholinergic effects and limited benefit in older adults.",
    severity: "moderate",
    evidence:
      "2023 AGS Beers Criteria: avoid most muscle relaxants in older adults.",
    suggestedAlternative:
      "Consider physical therapy and targeted non-sedating pain strategies.",
  },
];

const BURDEN_DEFINITIONS: BurdenDefinition[] = [
  {
    keywords: [
      "diphenhydramine",
      "hydroxyzine",
      "promethazine",
      "amitriptyline",
    ],
    weight: 0.7,
  },
  {
    keywords: ["diazepam", "lorazepam", "alprazolam", "clonazepam", "zolpidem"],
    weight: 0.6,
  },
  { keywords: ["cyclobenzaprine"], weight: 0.5 },
  { keywords: ["quetiapine", "olanzapine"], weight: 0.4 },
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

function inferRiskLevel(params: {
  beersFlags: BeersCriteriaFlag[];
  duplicateFlags: DuplicateTherapeuticClassFlag[];
  drugBurdenIndex: number;
  medicationCount: number;
  isElderly: boolean;
}): RiskLevel {
  const majorBeers = params.beersFlags.filter(
    (flag) => flag.severity === "major",
  ).length;
  const highDuplicates = params.duplicateFlags.filter(
    (flag) => flag.risk === "high",
  ).length;

  if (majorBeers >= 2 || highDuplicates >= 1 || params.drugBurdenIndex >= 1.5) {
    return "critical";
  }

  if (
    majorBeers >= 1 ||
    params.duplicateFlags.length >= 1 ||
    params.drugBurdenIndex >= 1.0
  ) {
    return "high";
  }

  if (
    params.medicationCount >= 8 ||
    (params.isElderly && params.medicationCount >= 5)
  ) {
    return "medium";
  }

  return "low";
}

/**
 * Rule-first polypharmacy risk analysis service with synthesis fallback support.
 */
export class PolypharmacyService {
  public constructor(
    private readonly logger: Logger,
    private readonly synthesisService: PolypharmacySynthesisEngine = new RuleOnlyPolypharmacySynthesisService(),
  ) {}

  public async analyzePolypharmacy(
    input: AnalyzePolypharmacyInput,
    requestId: string,
  ): Promise<AnalyzePolypharmacyResult> {
    const medications = asUnique(input.currentMedications);
    const conditions = asUnique(input.patientConditions).map((condition) =>
      toSlug(condition),
    );
    const isElderly = input.patientAge >= 65;

    if (medications.length === 0) {
      throw new AppError(
        "At least one medication is required for polypharmacy analysis.",
        "VALIDATION_ERROR",
      );
    }

    const beersFlags = isElderly ? this.getBeersFlags(medications) : [];
    const duplicateFlags = this.getDuplicateTherapeuticClassFlags(medications);
    const conditionFlags = this.getConditionSpecificWarnings(
      medications,
      conditions,
    );

    const combinedDuplicateFlags = [...duplicateFlags, ...conditionFlags];

    const drugBurdenIndex = this.calculateDrugBurdenIndex(medications);
    const deprescribingOpportunities = this.getDeprescribingOpportunities(
      beersFlags,
      combinedDuplicateFlags,
      medications,
      drugBurdenIndex,
    );

    const riskLevel = inferRiskLevel({
      beersFlags,
      duplicateFlags: combinedDuplicateFlags,
      drugBurdenIndex,
      medicationCount: medications.length,
      isElderly,
    });

    const synthesis = await this.safeSynthesize({
      patientAge: input.patientAge,
      patientConditions: conditions,
      currentMedications: medications,
      riskLevel,
      beersFlags,
      duplicateTherapeuticClasses: combinedDuplicateFlags,
      drugBurdenIndex,
      deprescribingOpportunities,
    });

    return {
      requestId,
      source: "rules-llm",
      analysisProvider: synthesis.provider,
      riskLevel,
      isElderly,
      medicationCount: medications.length,
      beersFlags,
      duplicateTherapeuticClasses: combinedDuplicateFlags,
      drugBurdenIndex,
      deprescribingOpportunities,
      summary: synthesis.summary,
      analysisRecommendations: synthesis.recommendations,
      llmTrace: synthesis.trace,
      llmTelemetry: synthesis.telemetry,
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
      for (const definition of MEDICATION_CLASS_DEFINITIONS) {
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
        risk: group.definition.riskIfDuplicate,
        rationale: group.definition.rationale,
      });
    }

    return flags;
  }

  private getConditionSpecificWarnings(
    medications: string[],
    conditions: string[],
  ): DuplicateTherapeuticClassFlag[] {
    const lowerConditions = conditions.map((condition) =>
      condition.toLowerCase(),
    );
    const flags: DuplicateTherapeuticClassFlag[] = [];

    const hasHeartFailure = lowerConditions.some(
      (condition) =>
        condition.includes("heart failure") || condition.includes("chf"),
    );
    if (hasHeartFailure) {
      const nsaids = medications.filter((medication) =>
        matchesMedication(medication, [
          "ibuprofen",
          "naproxen",
          "diclofenac",
          "indomethacin",
        ]),
      );
      if (nsaids.length > 0) {
        flags.push({
          className: "Condition Risk: Heart Failure + NSAID",
          medications: asUnique(nsaids),
          risk: "high",
          rationale:
            "NSAIDs may worsen fluid retention and heart failure outcomes, particularly with chronic exposure.",
        });
      }
    }

    const hasFallsOrDementia = lowerConditions.some(
      (condition) =>
        condition.includes("fall") ||
        condition.includes("dementia") ||
        condition.includes("cognitive"),
    );
    if (hasFallsOrDementia) {
      const sedatives = medications.filter((medication) =>
        matchesMedication(medication, [
          "diazepam",
          "lorazepam",
          "alprazolam",
          "clonazepam",
          "zolpidem",
        ]),
      );

      if (sedatives.length > 0) {
        flags.push({
          className: "Condition Risk: Falls/Cognitive Impairment + Sedatives",
          medications: asUnique(sedatives),
          risk: "high",
          rationale:
            "Sedative medications can increase confusion, gait instability, and fall risk in vulnerable patients.",
        });
      }
    }

    return flags;
  }

  private calculateDrugBurdenIndex(medications: string[]): number {
    let burden = 0;

    for (const medication of medications) {
      for (const definition of BURDEN_DEFINITIONS) {
        if (!matchesMedication(medication, definition.keywords)) {
          continue;
        }

        burden += definition.weight;
        break;
      }
    }

    return Number(Math.min(3, burden).toFixed(2));
  }

  private getDeprescribingOpportunities(
    beersFlags: BeersCriteriaFlag[],
    duplicateFlags: DuplicateTherapeuticClassFlag[],
    medications: string[],
    drugBurdenIndex: number,
  ): DeprescribingOpportunity[] {
    const opportunities: DeprescribingOpportunity[] = [];
    const seenMedications = new Set<string>();

    for (const flag of beersFlags) {
      const key = toSlug(flag.medication);
      if (seenMedications.has(key)) {
        continue;
      }

      seenMedications.add(key);

      const matchedDefinition = BEERS_DEFINITIONS.find((definition) =>
        matchesMedication(flag.medication, definition.keywords),
      );

      opportunities.push({
        medication: flag.medication,
        rationale: flag.reason,
        suggestedAction:
          matchedDefinition?.suggestedAlternative ??
          "Reassess indication and taper/discontinue when clinically appropriate.",
        priority: flag.severity === "major" ? "high" : "medium",
      });
    }

    for (const duplicateFlag of duplicateFlags) {
      if (duplicateFlag.medications.length < 2) {
        continue;
      }

      const targetMedication =
        duplicateFlag.medications[1] ?? duplicateFlag.medications[0];
      if (!targetMedication) {
        continue;
      }

      const key = `${duplicateFlag.className}:${toSlug(targetMedication)}`;
      if (seenMedications.has(key)) {
        continue;
      }

      seenMedications.add(key);

      opportunities.push({
        medication: targetMedication,
        rationale: duplicateFlag.rationale,
        suggestedAction: `Review necessity of concurrent ${duplicateFlag.className.toLowerCase()} therapy and discontinue redundant medication(s) where safe.`,
        priority:
          duplicateFlag.risk === "high"
            ? "high"
            : duplicateFlag.risk === "medium"
              ? "medium"
              : "low",
      });
    }

    const firstMedication = medications[0];
    if (drugBurdenIndex >= 1 && firstMedication) {
      opportunities.push({
        medication: firstMedication,
        rationale: `Estimated drug burden index is ${drugBurdenIndex}, suggesting elevated sedative/anticholinergic exposure.`,
        suggestedAction:
          "Prioritize tapering or switching sedative and anticholinergic medications to reduce cumulative burden.",
        priority: drugBurdenIndex >= 1.5 ? "high" : "medium",
      });
    }

    return opportunities.slice(0, 12);
  }

  private async safeSynthesize(
    input: PolypharmacySynthesisInput,
  ): Promise<PolypharmacySynthesisResult> {
    try {
      return await this.synthesisService.synthesize(input);
    } catch (error) {
      this.logger.warn(
        "Polypharmacy synthesis failed; falling back to rule-only summary.",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );

      return new RuleOnlyPolypharmacySynthesisService().synthesize(input);
    }
  }
}
