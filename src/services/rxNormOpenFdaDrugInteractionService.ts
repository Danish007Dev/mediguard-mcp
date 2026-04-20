import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type {
  CheckDrugInteractionsResult,
  InteractionLlmSynthesis,
  InteractionFinding,
  InteractionPatientContext,
  InteractionSeverity,
  RiskLevel,
} from "../types/medicationSafety";
import type { RxNormNormalizationResult } from "../types/rxnorm";
import type { OpenFdaClient, OpenFdaLabelData } from "../clients/openFdaClient";
import type { RxNormClient } from "../clients/rxNormClient";
import type { DrugInteractionService } from "./drugInteractionService";
import {
  RuleOnlyInteractionSynthesisService,
  type InteractionSynthesisInput,
  type InteractionSynthesisResult,
} from "./interactionSynthesisService";

const STOP_WORDS = new Set([
  "mg",
  "ml",
  "tablet",
  "capsule",
  "oral",
  "solution",
]);

const DRUG_CLASS_KEYWORDS: Record<string, string[]> = {
  warfarin: ["anticoagulant", "blood thinner", "coumadin", "jantoven"],
  ibuprofen: ["nsaid", "anti-inflammatory", "advil", "motrin"],
  aspirin: ["nsaid", "antiplatelet", "salicylate"],
  acetaminophen: ["acetaminophen", "apap", "tylenol"],
  simvastatin: ["statin", "hmg-coa reductase inhibitor"],
  clarithromycin: ["macrolide", "cyp3a4 inhibitor"],
};

const FALLBACK_INTERACTION_RULES: Array<{
  pair: [string, string];
  severity: InteractionSeverity;
  mechanism: string;
  clinicalImpact: string;
  recommendations: string[];
}> = [
  {
    pair: ["warfarin", "ibuprofen"],
    severity: "major",
    mechanism:
      "Concurrent anticoagulant and NSAID effects increase bleeding risk.",
    clinicalImpact:
      "Increased risk of gastrointestinal and intracranial bleeding.",
    recommendations: [
      "Avoid routine NSAID use when clinically feasible.",
      "Consider acetaminophen alternatives when appropriate.",
      "Increase INR and bleeding symptom monitoring if combination is unavoidable.",
    ],
  },
  {
    pair: ["warfarin", "aspirin"],
    severity: "major",
    mechanism:
      "Combined antithrombotic effects can potentiate bleeding complications.",
    clinicalImpact: "Increased risk of major bleeding events.",
    recommendations: [
      "Confirm dual-therapy clinical indication and duration.",
      "Monitor closely for signs of bleeding and adjust treatment plan as needed.",
    ],
  },
];

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function toSlug(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function asUniqueNames(values: string[]): string[] {
  const names = new Map<string, string>();

  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (!names.has(key)) {
      names.set(key, cleaned);
    }
  }

  return Array.from(names.values());
}

function inferRiskLevel(interactions: InteractionFinding[]): RiskLevel {
  if (
    interactions.some(
      (interaction) => interaction.severity === "contraindicated",
    )
  ) {
    return "critical";
  }

  if (interactions.some((interaction) => interaction.severity === "major")) {
    return "high";
  }

  if (interactions.some((interaction) => interaction.severity === "moderate")) {
    return "medium";
  }

  return "low";
}

function mapLlmSeverityToInteractionSeverity(
  severity: "low" | "moderate" | "high",
): InteractionSeverity {
  if (severity === "high") {
    return "major";
  }

  if (severity === "moderate") {
    return "moderate";
  }

  return "minor";
}

function mapLlmRiskToRiskLevel(risk: "low" | "moderate" | "high"): RiskLevel {
  if (risk === "high") {
    return "high";
  }

  if (risk === "moderate") {
    return "medium";
  }

  return "low";
}

function maxRiskLevel(left: RiskLevel, right: RiskLevel): RiskLevel {
  const priority: Record<RiskLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };

  return priority[left] >= priority[right] ? left : right;
}

function interactionPairKey(drugs: string[]): string {
  return drugs
    .map((drug) => toSlug(drug))
    .sort()
    .join("::");
}

function classifySeverity(text: string): InteractionSeverity {
  const normalized = text.toLowerCase();

  if (
    /(contraindicat|avoid concomitant|do not use together)/.test(normalized)
  ) {
    return "contraindicated";
  }

  if (
    /(major|severe|serious|life[-\s]?threatening|hemorrhag|bleed)/.test(
      normalized,
    )
  ) {
    return "major";
  }

  if (
    /(moderate|monitor closely|adjust dose|caution|may increase)/.test(
      normalized,
    )
  ) {
    return "moderate";
  }

  return "minor";
}

function recommendationsForSeverity(severity: InteractionSeverity): string[] {
  switch (severity) {
    case "contraindicated":
      return [
        "Avoid this combination and select a safer alternative.",
        "Escalate to clinical pharmacist or prescriber review immediately.",
      ];
    case "major":
      return [
        "Use an alternative agent when clinically feasible.",
        "If co-administration is necessary, increase monitoring and document mitigation plan.",
      ];
    case "moderate":
      return [
        "Monitor patient response and adverse effects more frequently.",
        "Adjust dosing or scheduling based on clinical judgment.",
      ];
    default:
      return [
        "Provide routine monitoring and counsel patient about potential symptoms.",
      ];
  }
}

function toAliases(
  result: RxNormNormalizationResult,
  label: OpenFdaLabelData | null,
): string[] {
  const baseTerms = [result.normalizedName, result.input];
  const aliasTerms = label?.aliases ?? [];

  const splitTerms = [...baseTerms, ...aliasTerms]
    .flatMap((entry) => entry.split(/[\s,/-]+/))
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 2 && !STOP_WORDS.has(entry));

  const combinedTerms = [...baseTerms, ...aliasTerms]
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 2);

  return Array.from(new Set([...combinedTerms, ...splitTerms]));
}

function matchesAnyAlias(text: string, aliases: string[]): boolean {
  const normalizedText = text.toLowerCase();

  return aliases.some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    return regex.test(normalizedText);
  });
}

function firstSentence(text: string): string {
  const sentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  const normalized = normalizeWhitespace(sentence);
  if (!normalized) {
    return normalizeWhitespace(text);
  }

  return normalized;
}

function truncate(text: string, maxLength = 320): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

interface MedicationContext {
  normalized: RxNormNormalizationResult;
  label: OpenFdaLabelData | null;
  aliases: string[];
}

type InteractionSynthesisEngine = {
  synthesize(
    input: InteractionSynthesisInput,
  ): Promise<InteractionSynthesisResult>;
};

function classTermsForDrug(drugName: string, aliases: string[]): string[] {
  const candidates = [
    toSlug(drugName),
    ...aliases.map((alias) => toSlug(alias)),
  ];
  const terms = new Set<string>();

  for (const [key, value] of Object.entries(DRUG_CLASS_KEYWORDS)) {
    if (candidates.some((candidate) => candidate.includes(key))) {
      value.forEach((item) => terms.add(item.toLowerCase()));
    }
  }

  return Array.from(terms);
}

function matchesDrugClassInteraction(
  text: string,
  drugName: string,
  aliases: string[],
): boolean {
  const normalizedText = text.toLowerCase();
  const terms = classTermsForDrug(drugName, aliases);
  return terms.some((term) => normalizedText.includes(term));
}

function getLabelEvidenceTexts(label: OpenFdaLabelData | null): string[] {
  if (!label) {
    return [];
  }

  return [...label.interactionText, ...label.warningText];
}

/**
 * Production interaction service combining RxNorm normalization and OpenFDA evidence.
 */
export class RxNormOpenFdaDrugInteractionService implements DrugInteractionService {
  public constructor(
    private readonly rxNormClient: RxNormClient,
    private readonly openFdaClient: OpenFdaClient,
    private readonly logger: Logger,
    private readonly synthesisService: InteractionSynthesisEngine = new RuleOnlyInteractionSynthesisService(),
  ) {}

  /**
   * Runs end-to-end interaction analysis for a medication list.
   */
  public async checkDrugInteractions(
    medications: string[],
    requestId: string,
    patientContext?: InteractionPatientContext,
  ): Promise<CheckDrugInteractionsResult> {
    const deduped = asUniqueNames(medications);
    if (deduped.length < 2) {
      throw new AppError(
        "At least two unique medication names are required for interaction checking.",
        "VALIDATION_ERROR",
        { minimumMedications: 2 },
      );
    }

    const normalized = await Promise.all(
      deduped.map((medication) =>
        this.rxNormClient.normalizeDrugName(medication),
      ),
    );

    const interactions = await this.getDrugInteractionsForRxcuis(
      normalized.map((entry) => entry.rxcui),
      normalized,
    );

    const riskLevel = inferRiskLevel(interactions);

    const synthesis = await this.safeSynthesize({
      medications: normalized.map((entry) => entry.normalizedName),
      interactions,
      riskLevel,
      patientContext,
    });

    const mergedInteractions = this.mergeSynthesisIntoFindings(
      interactions,
      synthesis,
    );

    const mergedRiskLevel = maxRiskLevel(
      inferRiskLevel(mergedInteractions),
      mapLlmRiskToRiskLevel(synthesis.overallRisk),
    );

    const llmSynthesis: InteractionLlmSynthesis = {
      overallRisk: synthesis.overallRisk,
      contextualizedSummary: synthesis.summary,
      interactionAnalyses: synthesis.interactionAnalyses,
    };

    return {
      requestId,
      source: "rxnorm-openfda",
      analysisProvider: synthesis.provider,
      riskLevel: mergedRiskLevel,
      medications: normalized.map((entry) => entry.normalizedName),
      patientContext,
      normalizedMedications: normalized,
      interactions: mergedInteractions,
      summary: synthesis.summary,
      analysisRecommendations: synthesis.recommendations,
      llmSynthesis,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Resolves pairwise interactions from medication RxCUIs and label evidence.
   */
  public async getDrugInteractionsForRxcuis(
    rxcuis: string[],
    preResolved?: RxNormNormalizationResult[],
  ): Promise<InteractionFinding[]> {
    if (rxcuis.length < 2) {
      return [];
    }

    const resolved =
      preResolved ??
      (await Promise.all(
        rxcuis.map(async (rxcui) => {
          const properties =
            await this.rxNormClient.getConceptProperties(rxcui);
          return {
            input: rxcui,
            normalizedName: properties.name,
            rxcui: properties.rxcui,
            tty: properties.tty,
            strategy: "rxcui-input" as const,
            genericMapped: false,
          };
        }),
      ));

    const medicationContexts: MedicationContext[] = [];

    for (const medication of resolved) {
      try {
        const label = await this.openFdaClient.getDrugLabelInteractions(
          medication.normalizedName,
        );

        medicationContexts.push({
          normalized: medication,
          label,
          aliases: toAliases(medication, label),
        });
      } catch (error) {
        this.logger.warn("OpenFDA lookup failed for medication", {
          medication: medication.normalizedName,
          error: error instanceof Error ? error.message : String(error),
        });

        medicationContexts.push({
          normalized: medication,
          label: null,
          aliases: toAliases(medication, null),
        });
      }
    }

    const findings = new Map<string, InteractionFinding>();

    for (let i = 0; i < medicationContexts.length; i += 1) {
      for (let j = i + 1; j < medicationContexts.length; j += 1) {
        const a = medicationContexts[i];
        const b = medicationContexts[j];
        if (!a || !b) {
          continue;
        }

        const key = [
          a.normalized.normalizedName.toLowerCase(),
          b.normalized.normalizedName.toLowerCase(),
        ]
          .sort()
          .join("::");

        const snippets: string[] = [];

        for (const text of getLabelEvidenceTexts(a.label)) {
          if (
            matchesAnyAlias(text, b.aliases) ||
            matchesDrugClassInteraction(
              text,
              b.normalized.normalizedName,
              b.aliases,
            )
          ) {
            snippets.push(text);
            break;
          }
        }

        for (const text of getLabelEvidenceTexts(b.label)) {
          if (
            matchesAnyAlias(text, a.aliases) ||
            matchesDrugClassInteraction(
              text,
              a.normalized.normalizedName,
              a.aliases,
            )
          ) {
            snippets.push(text);
            break;
          }
        }

        if (snippets.length > 0) {
          const mergedSnippet = truncate(snippets.join(" "));
          const severity = classifySeverity(mergedSnippet);

          findings.set(key, {
            drugs: [a.normalized.normalizedName, b.normalized.normalizedName],
            severity,
            mechanism: firstSentence(mergedSnippet),
            clinicalImpact: mergedSnippet,
            recommendations: recommendationsForSeverity(severity),
            evidence: `OpenFDA drug label interactions${
              a.label?.setId || b.label?.setId
                ? ` (set_ids: ${[a.label?.setId, b.label?.setId]
                    .filter((value): value is string => Boolean(value))
                    .join(", ")})`
                : ""
            }`,
          });
          continue;
        }

        const fallback = this.matchFallbackRule(
          a.normalized.normalizedName,
          b.normalized.normalizedName,
        );

        if (fallback) {
          findings.set(key, fallback);
        }
      }
    }

    return Array.from(findings.values());
  }

  private matchFallbackRule(a: string, b: string): InteractionFinding | null {
    const left = toSlug(a);
    const right = toSlug(b);

    for (const rule of FALLBACK_INTERACTION_RULES) {
      const [x, y] = rule.pair;
      const samePair =
        (left.includes(x) && right.includes(y)) ||
        (left.includes(y) && right.includes(x));

      if (!samePair) {
        continue;
      }

      return {
        drugs: [a, b],
        severity: rule.severity,
        mechanism: rule.mechanism,
        clinicalImpact: rule.clinicalImpact,
        recommendations: rule.recommendations,
        evidence:
          "Clinical fallback rule (used when label-level interaction text is unavailable).",
      };
    }

    return null;
  }

  private mergeSynthesisIntoFindings(
    findings: InteractionFinding[],
    synthesis: InteractionSynthesisResult,
  ): InteractionFinding[] {
    if (synthesis.interactionAnalyses.length === 0) {
      return findings;
    }

    const merged = new Map<string, InteractionFinding>(
      findings.map((finding) => [interactionPairKey(finding.drugs), finding]),
    );

    for (const analysis of synthesis.interactionAnalyses) {
      const key = interactionPairKey([analysis.drug1, analysis.drug2]);
      const existing = merged.get(key);
      const mappedSeverity = mapLlmSeverityToInteractionSeverity(
        analysis.severity,
      );
      const severity: InteractionSeverity =
        existing?.severity === "contraindicated" && analysis.severity === "high"
          ? "contraindicated"
          : mappedSeverity;

      const recommendations = Array.from(
        new Set([
          ...(existing?.recommendations ?? []),
          ...analysis.monitoringRecommendations,
          ...analysis.saferAlternatives,
        ]),
      ).slice(0, 8);

      merged.set(key, {
        drugs: [analysis.drug1, analysis.drug2],
        severity,
        mechanism: analysis.mechanism,
        clinicalImpact: analysis.reasoning,
        recommendations,
        evidence:
          existing?.evidence ??
          "Structured LLM synthesis from RxNorm/OpenFDA interaction evidence.",
      });
    }

    return Array.from(merged.values());
  }

  private async safeSynthesize(
    input: InteractionSynthesisInput,
  ): Promise<InteractionSynthesisResult> {
    try {
      return await this.synthesisService.synthesize(input);
    } catch (error) {
      this.logger.warn(
        "Interaction synthesis failed. Falling back to rule-based summary.",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );

      return new RuleOnlyInteractionSynthesisService().synthesize(input);
    }
  }
}
