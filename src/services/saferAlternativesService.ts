import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type {
  GetSaferAlternativesResult,
  RiskLevel,
  SaferAlternativeOption,
} from "../types/medicationSafety";
import {
  RuleOnlySaferAlternativesSynthesisService,
  type SaferAlternativesSynthesisInput,
  type SaferAlternativesSynthesisResult,
} from "./saferAlternativesSynthesisService";

export interface GetSaferAlternativesInput {
  proposedMedication: string;
  currentMedications: string[];
  patientAllergies: string[];
  patientConditions: string[];
  formularyPreferred: string[];
  maxAlternatives: number;
}

type SaferAlternativesSynthesisEngine = {
  synthesize(
    input: SaferAlternativesSynthesisInput,
  ): Promise<SaferAlternativesSynthesisResult>;
};

interface CandidateDefinition {
  medication: string;
  therapeuticClass: string;
  baseScore: number;
  rationale: string;
  avoidsRiskTags: string[];
  allergyKeywords?: string[];
  interactionPenalties?: Array<{
    medicationKeywords: string[];
    penalty: number;
    caution: string;
  }>;
  conditionPenalties?: Array<{
    conditionKeywords: string[];
    penalty: number;
    caution: string;
  }>;
}

interface TherapeuticSwitchRule {
  triggerKeywords: string[];
  defaultRiskTags: string[];
  candidates: CandidateDefinition[];
}

interface RiskSignal {
  tag: string;
  description: string;
  severity: RiskLevel;
}

const THERAPEUTIC_SWITCH_RULES: TherapeuticSwitchRule[] = [
  {
    triggerKeywords: [
      "ibuprofen",
      "naproxen",
      "diclofenac",
      "indomethacin",
      "ketorolac",
    ],
    defaultRiskTags: ["nsaid-general"],
    candidates: [
      {
        medication: "acetaminophen",
        therapeuticClass: "Non-opioid analgesic",
        baseScore: 90,
        rationale:
          "Provides analgesia while avoiding platelet and renal adverse effects associated with NSAIDs.",
        avoidsRiskTags: [
          "nsaid-general",
          "nsaid-bleeding",
          "nsaid-renal",
          "nsaid-heart-failure",
        ],
        allergyKeywords: ["acetaminophen", "paracetamol"],
        conditionPenalties: [
          {
            conditionKeywords: [
              "liver disease",
              "cirrhosis",
              "hepatic impairment",
            ],
            penalty: 22,
            caution: "Use lower total daily dose in chronic liver disease.",
          },
        ],
      },
      {
        medication: "topical lidocaine patch",
        therapeuticClass: "Topical local anesthetic",
        baseScore: 84,
        rationale:
          "Localized analgesia with minimal systemic interaction burden.",
        avoidsRiskTags: [
          "nsaid-general",
          "nsaid-bleeding",
          "nsaid-renal",
          "nsaid-heart-failure",
        ],
      },
      {
        medication: "celecoxib",
        therapeuticClass: "Selective COX-2 inhibitor",
        baseScore: 68,
        rationale:
          "May reduce some gastrointestinal bleeding risk compared with non-selective NSAIDs.",
        avoidsRiskTags: ["nsaid-general"],
        allergyKeywords: ["sulfa", "sulfonamide"],
        interactionPenalties: [
          {
            medicationKeywords: [
              "warfarin",
              "apixaban",
              "rivaroxaban",
              "dabigatran",
            ],
            penalty: 26,
            caution: "Bleeding risk may remain elevated with anticoagulants.",
          },
        ],
        conditionPenalties: [
          {
            conditionKeywords: [
              "chronic kidney disease",
              "ckd",
              "renal impairment",
            ],
            penalty: 24,
            caution: "Can still worsen renal perfusion in kidney disease.",
          },
          {
            conditionKeywords: ["heart failure", "chf"],
            penalty: 24,
            caution: "May increase fluid retention in heart failure.",
          },
        ],
      },
    ],
  },
  {
    triggerKeywords: [
      "diazepam",
      "lorazepam",
      "alprazolam",
      "clonazepam",
      "zolpidem",
      "eszopiclone",
    ],
    defaultRiskTags: ["sedation-general"],
    candidates: [
      {
        medication: "melatonin",
        therapeuticClass: "Sleep-wake cycle modulator",
        baseScore: 83,
        rationale:
          "Useful for sleep onset support with lower cognitive and fall risk than sedative hypnotics.",
        avoidsRiskTags: ["sedation-general", "sedation-fall"],
      },
      {
        medication: "buspirone",
        therapeuticClass: "Non-benzodiazepine anxiolytic",
        baseScore: 80,
        rationale:
          "Anxiolytic option without major respiratory depression risk of benzodiazepines.",
        avoidsRiskTags: ["sedation-general", "sedation-fall"],
      },
      {
        medication: "trazodone (low dose)",
        therapeuticClass: "Serotonergic antidepressant",
        baseScore: 66,
        rationale:
          "Sometimes used as a sleep aid when non-pharmacologic options are inadequate.",
        avoidsRiskTags: ["sedation-general"],
        conditionPenalties: [
          {
            conditionKeywords: ["fall", "dementia", "cognitive impairment"],
            penalty: 18,
            caution: "May still contribute to orthostasis and fall risk.",
          },
        ],
      },
    ],
  },
  {
    triggerKeywords: ["glyburide", "glimepiride", "glipizide"],
    defaultRiskTags: ["hypoglycemia-risk"],
    candidates: [
      {
        medication: "metformin",
        therapeuticClass: "Biguanide",
        baseScore: 86,
        rationale:
          "First-line type 2 diabetes therapy with lower hypoglycemia risk than sulfonylureas.",
        avoidsRiskTags: ["hypoglycemia-risk"],
        conditionPenalties: [
          {
            conditionKeywords: [
              "chronic kidney disease stage 4",
              "dialysis",
              "severe renal impairment",
            ],
            penalty: 30,
            caution: "Avoid in severe renal impairment.",
          },
        ],
      },
      {
        medication: "sitagliptin",
        therapeuticClass: "DPP-4 inhibitor",
        baseScore: 80,
        rationale:
          "Low hypoglycemia risk and generally favorable tolerability.",
        avoidsRiskTags: ["hypoglycemia-risk"],
      },
      {
        medication: "empagliflozin",
        therapeuticClass: "SGLT2 inhibitor",
        baseScore: 78,
        rationale:
          "Cardiometabolic benefits in appropriate patients and low hypoglycemia risk.",
        avoidsRiskTags: ["hypoglycemia-risk"],
        conditionPenalties: [
          {
            conditionKeywords: ["recurrent uti", "frequent urinary infection"],
            penalty: 16,
            caution: "May increase risk of genital or urinary infections.",
          },
        ],
      },
    ],
  },
  {
    triggerKeywords: [
      "omeprazole",
      "pantoprazole",
      "lansoprazole",
      "esomeprazole",
    ],
    defaultRiskTags: ["long-term-ppi"],
    candidates: [
      {
        medication: "famotidine",
        therapeuticClass: "H2 receptor antagonist",
        baseScore: 80,
        rationale:
          "Can control acid symptoms in some patients with lower long-term PPI adverse-effect burden.",
        avoidsRiskTags: ["long-term-ppi"],
      },
      {
        medication: "alginate antacid therapy",
        therapeuticClass: "Barrier/antacid therapy",
        baseScore: 72,
        rationale:
          "Symptom-targeted option that may reduce need for chronic PPI exposure.",
        avoidsRiskTags: ["long-term-ppi"],
      },
    ],
  },
];

const FALLBACK_CANDIDATES: CandidateDefinition[] = [
  {
    medication: "indication-specific specialist review",
    therapeuticClass: "Clinical review",
    baseScore: 60,
    rationale:
      "No direct therapeutic-class mapping found; specialist review recommended for safer substitution.",
    avoidsRiskTags: [],
  },
];

const RISK_BONUS_PER_MATCH = 7;

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

function matchesKeywordSet(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function clampScore(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 100) {
    return 100;
  }

  return Math.round(value);
}

function highestSeverity(severities: RiskLevel[]): RiskLevel {
  if (severities.includes("critical")) {
    return "critical";
  }

  if (severities.includes("high")) {
    return "high";
  }

  if (severities.includes("medium")) {
    return "medium";
  }

  return "low";
}

/**
 * Ranks safer therapeutic alternatives from risk signals and formulary preferences.
 */
export class SaferAlternativesService {
  public constructor(
    private readonly logger: Logger,
    private readonly synthesisService: SaferAlternativesSynthesisEngine = new RuleOnlySaferAlternativesSynthesisService(),
  ) {}

  public async getSaferAlternatives(
    input: GetSaferAlternativesInput,
    requestId: string,
  ): Promise<GetSaferAlternativesResult> {
    const proposedMedication = normalizeWhitespace(input.proposedMedication);
    if (!proposedMedication) {
      throw new AppError(
        "Proposed medication is required.",
        "VALIDATION_ERROR",
      );
    }

    const proposedSlug = toSlug(proposedMedication);
    const currentMeds = asUnique(input.currentMedications).map((medication) =>
      toSlug(medication),
    );
    const allergies = asUnique(input.patientAllergies).map((allergy) =>
      toSlug(allergy),
    );
    const conditions = asUnique(input.patientConditions).map((condition) =>
      toSlug(condition),
    );
    const formularySet = new Set(
      asUnique(input.formularyPreferred).map((entry) => toSlug(entry)),
    );

    const riskSignals = this.buildRiskSignals(
      proposedSlug,
      currentMeds,
      conditions,
    );
    const riskLevel = highestSeverity(
      riskSignals.map((signal) => signal.severity),
    );
    const riskContext = riskSignals.map((signal) => signal.description);

    const switchRule = THERAPEUTIC_SWITCH_RULES.find((rule) =>
      matchesKeywordSet(proposedSlug, rule.triggerKeywords),
    );

    const ruleCandidates = switchRule?.candidates ?? FALLBACK_CANDIDATES;
    const riskTags = new Set<string>([
      ...(switchRule?.defaultRiskTags ?? []),
      ...riskSignals.map((signal) => signal.tag),
    ]);

    const alternatives = this.rankCandidates({
      candidates: ruleCandidates,
      riskSignals,
      riskTags,
      currentMeds,
      allergies,
      conditions,
      formularySet,
      maxAlternatives: input.maxAlternatives,
    });

    const synthesis = await this.safeSynthesize({
      proposedMedication,
      riskLevel,
      riskContext,
      alternatives,
    });

    return {
      requestId,
      source: "rules-formulary-llm",
      analysisProvider: synthesis.provider,
      riskLevel,
      proposedMedication,
      riskContext,
      alternatives,
      summary: synthesis.summary,
      analysisRecommendations: synthesis.recommendations,
      llmTrace: synthesis.trace,
      llmTelemetry: synthesis.telemetry,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildRiskSignals(
    proposedMedication: string,
    currentMedications: string[],
    conditions: string[],
  ): RiskSignal[] {
    const signals: RiskSignal[] = [];

    const proposedIsNsaid = matchesKeywordSet(proposedMedication, [
      "ibuprofen",
      "naproxen",
      "diclofenac",
      "indomethacin",
      "ketorolac",
    ]);

    if (
      proposedIsNsaid &&
      currentMedications.some((medication) =>
        matchesKeywordSet(medication, [
          "warfarin",
          "apixaban",
          "rivaroxaban",
          "dabigatran",
        ]),
      )
    ) {
      signals.push({
        tag: "nsaid-bleeding",
        description:
          "Current anticoagulant use increases major bleeding risk with NSAID therapy.",
        severity: "high",
      });
    }

    if (
      proposedIsNsaid &&
      conditions.some((condition) =>
        matchesKeywordSet(condition, [
          "chronic kidney disease",
          "ckd",
          "renal impairment",
        ]),
      )
    ) {
      signals.push({
        tag: "nsaid-renal",
        description:
          "Kidney disease increases nephrotoxicity risk with NSAID exposure.",
        severity: "high",
      });
    }

    if (
      proposedIsNsaid &&
      conditions.some((condition) =>
        matchesKeywordSet(condition, ["heart failure", "chf"]),
      )
    ) {
      signals.push({
        tag: "nsaid-heart-failure",
        description:
          "Heart failure status can worsen with NSAID-related fluid retention.",
        severity: "high",
      });
    }

    const proposedIsSedative = matchesKeywordSet(proposedMedication, [
      "diazepam",
      "lorazepam",
      "alprazolam",
      "clonazepam",
      "zolpidem",
      "eszopiclone",
    ]);

    if (
      proposedIsSedative &&
      conditions.some((condition) =>
        matchesKeywordSet(condition, [
          "fall",
          "dementia",
          "cognitive impairment",
        ]),
      )
    ) {
      signals.push({
        tag: "sedation-fall",
        description:
          "Sedative medications can increase confusion and fall risk in this patient context.",
        severity: "high",
      });
    }

    const proposedIsTeratogenic = matchesKeywordSet(proposedMedication, [
      "isotretinoin",
      "valproate",
      "methotrexate",
      "warfarin",
    ]);

    if (
      proposedIsTeratogenic &&
      conditions.some((condition) =>
        matchesKeywordSet(condition, ["pregnant", "pregnancy", "gestation"]),
      )
    ) {
      signals.push({
        tag: "pregnancy-teratogen",
        description:
          "Medication is associated with substantial fetal toxicity risk during pregnancy.",
        severity: "critical",
      });
    }

    if (signals.length === 0) {
      signals.push({
        tag: "general-risk-review",
        description:
          "General safety optimization requested for this medication.",
        severity: "low",
      });
    }

    return signals;
  }

  private rankCandidates(params: {
    candidates: CandidateDefinition[];
    riskSignals: RiskSignal[];
    riskTags: Set<string>;
    currentMeds: string[];
    allergies: string[];
    conditions: string[];
    formularySet: Set<string>;
    maxAlternatives: number;
  }): SaferAlternativeOption[] {
    const riskByTag = new Map(
      params.riskSignals.map((signal) => [signal.tag, signal]),
    );

    const scored = params.candidates
      .map((candidate): SaferAlternativeOption | null => {
        const candidateSlug = toSlug(candidate.medication);

        const allergyKeywords = candidate.allergyKeywords ?? [candidateSlug];
        const conflictsWithAllergy = params.allergies.some((allergy) =>
          matchesKeywordSet(allergy, allergyKeywords),
        );

        if (conflictsWithAllergy) {
          return null;
        }

        let score = candidate.baseScore;
        const cautionFlags: string[] = [];

        if (candidate.interactionPenalties) {
          for (const penaltyRule of candidate.interactionPenalties) {
            if (
              params.currentMeds.some((medication) =>
                matchesKeywordSet(medication, penaltyRule.medicationKeywords),
              )
            ) {
              score -= penaltyRule.penalty;
              cautionFlags.push(penaltyRule.caution);
            }
          }
        }

        if (candidate.conditionPenalties) {
          for (const penaltyRule of candidate.conditionPenalties) {
            if (
              params.conditions.some((condition) =>
                matchesKeywordSet(condition, penaltyRule.conditionKeywords),
              )
            ) {
              score -= penaltyRule.penalty;
              cautionFlags.push(penaltyRule.caution);
            }
          }
        }

        const matchedAvoids = candidate.avoidsRiskTags
          .filter((tag) => params.riskTags.has(tag))
          .map((tag) => riskByTag.get(tag)?.description)
          .filter((entry): entry is string => Boolean(entry));

        score += matchedAvoids.length * RISK_BONUS_PER_MATCH;

        const formularyPreferred = params.formularySet.has(candidateSlug);
        if (formularyPreferred) {
          score += 12;
        }

        const safetyScore = clampScore(score);
        if (safetyScore < 35) {
          return null;
        }

        return {
          medication: candidate.medication,
          therapeuticClass: candidate.therapeuticClass,
          safetyScore,
          formularyPreferred,
          avoidsRisks: matchedAvoids,
          cautionFlags: asUnique(cautionFlags),
          rationale: candidate.rationale,
        };
      })
      .filter((entry): entry is SaferAlternativeOption => entry !== null)
      .sort((a, b) => b.safetyScore - a.safetyScore);

    return scored.slice(0, Math.max(1, params.maxAlternatives));
  }

  private async safeSynthesize(
    input: SaferAlternativesSynthesisInput,
  ): Promise<SaferAlternativesSynthesisResult> {
    try {
      return await this.synthesisService.synthesize(input);
    } catch (error) {
      this.logger.warn(
        "Safer-alternatives synthesis failed; using rule-only summary fallback.",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );

      return new RuleOnlySaferAlternativesSynthesisService().synthesize(input);
    }
  }
}
