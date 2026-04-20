import type { DailyMedClient } from "../clients/dailyMedClient";
import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type {
  CheckContraindicationsResult,
  ContraindicationFinding,
  ContraindicationLabelEvidence,
  RiskLevel,
} from "../types/medicationSafety";
import {
  RuleOnlyContraindicationSynthesisService,
  type ContraindicationSynthesisInput,
  type ContraindicationSynthesisResult,
} from "./contraindicationSynthesisService";

export interface CheckContraindicationsInput {
  proposedMedication: string;
  patientAllergies: string[];
  patientConditions: string[];
  labValues?: Record<string, unknown>;
}

type ContraindicationSynthesisEngine = {
  synthesize(
    input: ContraindicationSynthesisInput,
  ): Promise<ContraindicationSynthesisResult>;
};

interface KeywordRule {
  medicationKeywords: string[];
  allergyKeywords?: string[];
  conditionKeywords?: string[];
  trigger: "allergy" | "condition" | "pregnancy";
  severity: "moderate" | "major" | "contraindicated";
  rationale: string;
  recommendation: string;
  evidence: string;
}

const ALLERGY_RULES: KeywordRule[] = [
  {
    medicationKeywords: [
      "amoxicillin",
      "ampicillin",
      "penicillin",
      "augmentin",
      "piperacillin",
    ],
    allergyKeywords: ["penicillin", "amoxicillin", "beta-lactam"],
    trigger: "allergy",
    severity: "contraindicated",
    rationale:
      "Documented beta-lactam allergy with likely cross-reactivity to penicillin-class therapy.",
    recommendation:
      "Avoid penicillin-class therapy and consider a non-beta-lactam alternative.",
    evidence:
      "Drug-allergy cross-reactivity rule for penicillin-class antibiotics.",
  },
  {
    medicationKeywords: ["cephalexin", "ceftriaxone", "cefuroxime", "cefdinir"],
    allergyKeywords: ["cephalosporin", "cef"],
    trigger: "allergy",
    severity: "major",
    rationale:
      "Reported cephalosporin allergy may recur with another cephalosporin agent.",
    recommendation:
      "Avoid related cephalosporins unless allergy history has been clarified and risk is acceptable.",
    evidence: "Class allergy rule for cephalosporins.",
  },
  {
    medicationKeywords: [
      "sulfamethoxazole",
      "sulfasalazine",
      "trimethoprim-sulfamethoxazole",
    ],
    allergyKeywords: ["sulfa", "sulfonamide", "sulfamethoxazole"],
    trigger: "allergy",
    severity: "contraindicated",
    rationale:
      "Sulfonamide allergy may trigger severe hypersensitivity with sulfonamide antibiotics.",
    recommendation:
      "Avoid sulfonamide antibiotics and select a non-sulfonamide option.",
    evidence: "Drug-allergy rule for sulfonamide antibiotics.",
  },
  {
    medicationKeywords: [
      "ibuprofen",
      "naproxen",
      "diclofenac",
      "indomethacin",
      "ketorolac",
    ],
    allergyKeywords: ["nsaid", "aspirin", "ibuprofen", "naproxen"],
    trigger: "allergy",
    severity: "major",
    rationale:
      "NSAID allergy can recur across related nonsteroidal anti-inflammatory medications.",
    recommendation:
      "Avoid non-selective NSAIDs and consider alternative analgesics.",
    evidence: "Class cross-reactivity rule for NSAID hypersensitivity.",
  },
];

const CONDITION_RULES: KeywordRule[] = [
  {
    medicationKeywords: ["metformin"],
    conditionKeywords: ["chronic kidney disease", "ckd", "renal impairment"],
    trigger: "condition",
    severity: "major",
    rationale:
      "Reduced renal function may increase metformin accumulation and lactic acidosis risk.",
    recommendation:
      "Review renal function and consider dose reduction or alternative glucose-lowering therapy.",
    evidence: "Metformin renal impairment warning rule.",
  },
  {
    medicationKeywords: [
      "isotretinoin",
      "warfarin",
      "valproate",
      "methotrexate",
    ],
    conditionKeywords: ["pregnant", "pregnancy", "gestation"],
    trigger: "pregnancy",
    severity: "contraindicated",
    rationale:
      "Medication carries substantial fetal toxicity risk during pregnancy.",
    recommendation:
      "Avoid this medication in pregnancy and use a safer alternative.",
    evidence: "Pregnancy contraindication rule for teratogenic medications.",
  },
  {
    medicationKeywords: ["propranolol", "nadolol", "timolol"],
    conditionKeywords: ["asthma", "bronchospasm"],
    trigger: "condition",
    severity: "major",
    rationale:
      "Non-selective beta-blockade may precipitate bronchospasm in asthma.",
    recommendation:
      "Avoid non-selective beta-blockers; consider a cardio-selective option if needed.",
    evidence: "Asthma plus non-selective beta-blocker risk rule.",
  },
  {
    medicationKeywords: ["pioglitazone", "rosiglitazone"],
    conditionKeywords: ["heart failure", "chf"],
    trigger: "condition",
    severity: "major",
    rationale:
      "Thiazolidinediones can worsen fluid retention and heart failure status.",
    recommendation:
      "Avoid or closely reassess need for thiazolidinedione therapy.",
    evidence: "Heart failure contraindication/caution for TZD class.",
  },
  {
    medicationKeywords: ["methotrexate", "valproate"],
    conditionKeywords: ["liver disease", "cirrhosis", "hepatic impairment"],
    trigger: "condition",
    severity: "major",
    rationale: "Underlying hepatic disease increases risk for hepatotoxicity.",
    recommendation:
      "Avoid hepatotoxic agents when possible and consider safer alternatives.",
    evidence:
      "Liver disease contraindication/caution rule for hepatotoxic medications.",
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

function matchesKeywordSet(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function parseNumericLabValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      return undefined;
    }

    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function normalizeLabs(
  labValues?: Record<string, unknown>,
): Record<string, number> {
  if (!labValues) {
    return {};
  }

  const normalized: Record<string, number> = {};

  for (const [key, rawValue] of Object.entries(labValues)) {
    const parsed = parseNumericLabValue(rawValue);
    if (parsed !== undefined) {
      normalized[toSlug(key)] = parsed;
    }
  }

  return normalized;
}

function findLabValue(
  labs: Record<string, number>,
  aliases: string[],
): number | undefined {
  for (const alias of aliases) {
    const normalizedAlias = toSlug(alias);
    if (normalizedAlias in labs) {
      return labs[normalizedAlias];
    }
  }

  return undefined;
}

function mergeFindings(
  findings: ContraindicationFinding[],
): ContraindicationFinding[] {
  const unique = new Map<string, ContraindicationFinding>();

  for (const finding of findings) {
    const key = [
      finding.medication.toLowerCase(),
      finding.trigger,
      finding.severity,
      finding.rationale.toLowerCase(),
    ].join("|");

    if (!unique.has(key)) {
      unique.set(key, finding);
    }
  }

  return Array.from(unique.values());
}

function inferRiskLevel(findings: ContraindicationFinding[]): RiskLevel {
  const contraindicatedCount = findings.filter(
    (finding) => finding.severity === "contraindicated",
  ).length;
  const majorCount = findings.filter(
    (finding) => finding.severity === "major",
  ).length;
  const moderateCount = findings.filter(
    (finding) => finding.severity === "moderate",
  ).length;

  if (contraindicatedCount > 0) {
    return "critical";
  }

  if (majorCount >= 2) {
    return "high";
  }

  if (majorCount >= 1 || moderateCount >= 2) {
    return "medium";
  }

  return "low";
}

function emptyLabelEvidence(): ContraindicationLabelEvidence {
  return {
    contraindications: [],
    warnings: [],
    pregnancy: [],
    renal: [],
    hepatic: [],
  };
}

/**
 * Contraindication engine combining rules, labs, and DailyMed-derived label evidence.
 */
export class ContraindicationService {
  public constructor(
    private readonly logger: Logger,
    private readonly dailyMedClient: DailyMedClient,
    private readonly synthesisService: ContraindicationSynthesisEngine = new RuleOnlyContraindicationSynthesisService(),
  ) {}

  public async checkContraindications(
    input: CheckContraindicationsInput,
    requestId: string,
  ): Promise<CheckContraindicationsResult> {
    const medication = normalizeWhitespace(input.proposedMedication);
    if (!medication) {
      throw new AppError(
        "Proposed medication is required.",
        "VALIDATION_ERROR",
      );
    }

    const medicationSlug = toSlug(medication);
    const allergies = asUnique(input.patientAllergies).map((entry) =>
      toSlug(entry),
    );
    const conditions = asUnique(input.patientConditions).map((entry) =>
      toSlug(entry),
    );
    const normalizedLabs = normalizeLabs(input.labValues);

    const findings: ContraindicationFinding[] = [
      ...this.getAllergyFindings(medication, medicationSlug, allergies),
      ...this.getConditionFindings(medication, medicationSlug, conditions),
      ...this.getLabFindings(medication, medicationSlug, normalizedLabs),
    ];

    let labelEvidence = emptyLabelEvidence();

    try {
      const dailyMedData =
        await this.dailyMedClient.getDrugLabelSections(medication);
      if (dailyMedData) {
        labelEvidence = {
          setId: dailyMedData.setId,
          title: dailyMedData.title,
          contraindications: dailyMedData.sections.contraindications,
          warnings: dailyMedData.sections.warnings,
          pregnancy: dailyMedData.sections.pregnancy,
          renal: dailyMedData.sections.renal,
          hepatic: dailyMedData.sections.hepatic,
        };

        findings.push(
          ...this.getLabelDerivedFindings(
            medication,
            conditions,
            normalizedLabs,
            dailyMedData.sections,
          ),
        );
      }
    } catch (error) {
      this.logger.warn(
        "DailyMed lookup failed; continuing with rule-only contraindication checks.",
        {
          medication,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const deduplicatedFindings = mergeFindings(findings);
    const riskLevel = inferRiskLevel(deduplicatedFindings);

    const synthesis = await this.safeSynthesize({
      proposedMedication: medication,
      patientAllergies: allergies,
      patientConditions: conditions,
      normalizedLabs,
      riskLevel,
      contraindications: deduplicatedFindings,
    });

    return {
      requestId,
      source: "rules-dailymed",
      analysisProvider: synthesis.provider,
      riskLevel,
      contraindicated: deduplicatedFindings.some(
        (finding) => finding.severity === "contraindicated",
      ),
      proposedMedication: medication,
      contraindications: deduplicatedFindings,
      summary: synthesis.summary,
      analysisRecommendations: synthesis.recommendations,
      llmTrace: synthesis.trace,
      llmTelemetry: synthesis.telemetry,
      labelEvidence,
      generatedAt: new Date().toISOString(),
    };
  }

  private getAllergyFindings(
    medication: string,
    medicationSlug: string,
    allergies: string[],
  ): ContraindicationFinding[] {
    const findings: ContraindicationFinding[] = [];

    for (const rule of ALLERGY_RULES) {
      if (!matchesKeywordSet(medicationSlug, rule.medicationKeywords)) {
        continue;
      }

      const allergyKeywords = rule.allergyKeywords ?? [];
      const hasMatchingAllergy = allergies.some((allergy) =>
        matchesKeywordSet(allergy, allergyKeywords),
      );

      if (!hasMatchingAllergy) {
        continue;
      }

      findings.push({
        medication,
        trigger: rule.trigger,
        severity: rule.severity,
        rationale: rule.rationale,
        recommendation: rule.recommendation,
        evidence: rule.evidence,
        source: "rules",
      });
    }

    return findings;
  }

  private getConditionFindings(
    medication: string,
    medicationSlug: string,
    conditions: string[],
  ): ContraindicationFinding[] {
    const findings: ContraindicationFinding[] = [];

    for (const rule of CONDITION_RULES) {
      if (!matchesKeywordSet(medicationSlug, rule.medicationKeywords)) {
        continue;
      }

      const conditionKeywords = rule.conditionKeywords ?? [];
      const hasMatchingCondition = conditions.some((condition) =>
        matchesKeywordSet(condition, conditionKeywords),
      );

      if (!hasMatchingCondition) {
        continue;
      }

      findings.push({
        medication,
        trigger: rule.trigger,
        severity: rule.severity,
        rationale: rule.rationale,
        recommendation: rule.recommendation,
        evidence: rule.evidence,
        source: "rules",
      });
    }

    return findings;
  }

  private getLabFindings(
    medication: string,
    medicationSlug: string,
    labs: Record<string, number>,
  ): ContraindicationFinding[] {
    const findings: ContraindicationFinding[] = [];
    const egfr = findLabValue(labs, ["egfr", "gfr", "estimated gfr"]);
    const creatinine = findLabValue(labs, ["creatinine", "serum creatinine"]);
    const alt = findLabValue(labs, ["alt", "alanine aminotransferase"]);
    const ast = findLabValue(labs, ["ast", "aspartate aminotransferase"]);
    const potassium = findLabValue(labs, ["potassium", "k"]);

    if (medicationSlug.includes("metformin")) {
      if (egfr !== undefined && egfr < 30) {
        findings.push({
          medication,
          trigger: "lab",
          severity: "contraindicated",
          rationale: `eGFR ${egfr} mL/min indicates severe renal impairment.`,
          recommendation: "Avoid metformin when eGFR is below 30 mL/min.",
          evidence: "Metformin renal threshold safety rule (eGFR < 30).",
          source: "rules",
        });
      } else if (egfr !== undefined && egfr < 45) {
        findings.push({
          medication,
          trigger: "lab",
          severity: "major",
          rationale: `eGFR ${egfr} mL/min indicates reduced renal reserve.`,
          recommendation:
            "Use lower dose and monitor renal function more frequently.",
          evidence: "Metformin dose-adjustment rule (eGFR 30-44).",
          source: "rules",
        });
      }

      if (creatinine !== undefined && creatinine >= 2) {
        findings.push({
          medication,
          trigger: "lab",
          severity: "major",
          rationale: `Creatinine ${creatinine} mg/dL suggests significant renal dysfunction.`,
          recommendation:
            "Reassess metformin appropriateness and confirm renal trend.",
          evidence: "Metformin renal dysfunction safety rule using creatinine.",
          source: "rules",
        });
      }
    }

    if (
      matchesKeywordSet(medicationSlug, [
        "ibuprofen",
        "naproxen",
        "diclofenac",
        "indomethacin",
      ]) &&
      egfr !== undefined &&
      egfr < 30
    ) {
      findings.push({
        medication,
        trigger: "lab",
        severity: "major",
        rationale: `eGFR ${egfr} mL/min suggests NSAID nephrotoxicity risk is elevated.`,
        recommendation:
          "Avoid NSAIDs in severe renal impairment and use kidney-safe analgesia.",
        evidence: "NSAID renal impairment warning rule (eGFR < 30).",
        source: "rules",
      });
    }

    if (
      matchesKeywordSet(medicationSlug, [
        "valproate",
        "methotrexate",
        "atorvastatin",
        "simvastatin",
        "rosuvastatin",
      ]) &&
      ((alt !== undefined && alt >= 120) || (ast !== undefined && ast >= 120))
    ) {
      findings.push({
        medication,
        trigger: "lab",
        severity: "major",
        rationale:
          "Markedly elevated transaminases increase risk of drug-induced liver injury.",
        recommendation:
          "Avoid or defer hepatotoxic therapy until liver enzymes improve.",
        evidence: "Hepatotoxic medication safety rule using AST/ALT elevation.",
        source: "rules",
      });
    }

    if (
      matchesKeywordSet(medicationSlug, [
        "spironolactone",
        "eplerenone",
        "lisinopril",
        "enalapril",
      ]) &&
      potassium !== undefined &&
      potassium > 5.5
    ) {
      findings.push({
        medication,
        trigger: "lab",
        severity: "major",
        rationale: `Potassium ${potassium} mmol/L suggests baseline hyperkalemia.`,
        recommendation:
          "Avoid potassium-raising medications until potassium is corrected.",
        evidence:
          "Hyperkalemia rule for mineralocorticoid receptor antagonists and ACE inhibitors.",
        source: "rules",
      });
    }

    return findings;
  }

  private getLabelDerivedFindings(
    medication: string,
    conditions: string[],
    labs: Record<string, number>,
    sections: ContraindicationLabelEvidence,
  ): ContraindicationFinding[] {
    const findings: ContraindicationFinding[] = [];

    const hasPregnancy = conditions.some((condition) =>
      matchesKeywordSet(condition, ["pregnant", "pregnancy", "gestation"]),
    );

    if (hasPregnancy && sections.pregnancy.length > 0) {
      const pregnancyText = sections.pregnancy.join(" ").toLowerCase();
      const severe =
        pregnancyText.includes("contraindicated") ||
        pregnancyText.includes("pregnancy category x") ||
        pregnancyText.includes("fetal toxicity");

      findings.push({
        medication,
        trigger: "pregnancy",
        severity: severe ? "contraindicated" : "major",
        rationale:
          "DailyMed pregnancy section indicates clinically significant fetal risk language.",
        recommendation:
          "Use pregnancy-safer alternatives and document risk-benefit discussion.",
        evidence:
          sections.pregnancy[0] ?? "DailyMed pregnancy section warning.",
        source: "dailymed",
      });
    }

    const egfr = findLabValue(labs, ["egfr", "gfr", "estimated gfr"]);
    if (egfr !== undefined && egfr < 60 && sections.renal.length > 0) {
      findings.push({
        medication,
        trigger: "lab",
        severity: egfr < 30 ? "major" : "moderate",
        rationale:
          "DailyMed renal section indicates impairment-related dosing or safety concern.",
        recommendation:
          "Adjust dose per renal function guidance and increase monitoring if therapy proceeds.",
        evidence: sections.renal[0] ?? "DailyMed renal impairment guidance.",
        source: "dailymed",
      });
    }

    const hasLiverDisease = conditions.some((condition) =>
      matchesKeywordSet(condition, ["liver", "hepatic", "cirrhosis"]),
    );

    const alt = findLabValue(labs, ["alt", "alanine aminotransferase"]);
    const ast = findLabValue(labs, ["ast", "aspartate aminotransferase"]);

    if (
      (hasLiverDisease ||
        (alt !== undefined && alt >= 120) ||
        (ast !== undefined && ast >= 120)) &&
      sections.hepatic.length > 0
    ) {
      findings.push({
        medication,
        trigger: "label-warning",
        severity: "major",
        rationale:
          "DailyMed hepatic section highlights caution in liver dysfunction.",
        recommendation:
          "Prefer non-hepatotoxic alternatives or intensify liver monitoring if required.",
        evidence: sections.hepatic[0] ?? "DailyMed hepatic warning section.",
        source: "dailymed",
      });
    }

    const warningText = sections.warnings.join(" ").toLowerCase();
    if (
      warningText.includes("hypersensitivity") &&
      conditions.some((condition) =>
        matchesKeywordSet(condition, ["anaphylaxis"]),
      )
    ) {
      findings.push({
        medication,
        trigger: "label-warning",
        severity: "major",
        rationale:
          "DailyMed warning section includes serious hypersensitivity precautions.",
        recommendation:
          "Confirm prior severe reactions before prescribing and prepare emergency precautions.",
        evidence:
          sections.warnings[0] ?? "DailyMed warnings and precautions section.",
        source: "dailymed",
      });
    }

    return findings;
  }

  private async safeSynthesize(
    input: ContraindicationSynthesisInput,
  ): Promise<ContraindicationSynthesisResult> {
    try {
      return await this.synthesisService.synthesize(input);
    } catch (error) {
      this.logger.warn(
        "Contraindication synthesis failed; using rule-only summary fallback.",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );

      return new RuleOnlyContraindicationSynthesisService().synthesize(input);
    }
  }
}
