import type { GeminiClient } from "../clients/geminiClient";
import type { GroqClient } from "../clients/groqClient";
import type { Logger } from "../logging/logger";
import type {
  BeersCriteriaFlag,
  DeprescribingOpportunity,
  DuplicateTherapeuticClassFlag,
  RiskLevel,
} from "../types/medicationSafety";

type AnalysisProvider = "groq" | "gemini" | "rule-based";

export interface PolypharmacySynthesisInput {
  patientAge: number;
  patientConditions: string[];
  currentMedications: string[];
  riskLevel: RiskLevel;
  beersFlags: BeersCriteriaFlag[];
  duplicateTherapeuticClasses: DuplicateTherapeuticClassFlag[];
  drugBurdenIndex: number;
  deprescribingOpportunities: DeprescribingOpportunity[];
}

export interface PolypharmacySynthesisResult {
  summary: string;
  recommendations: string[];
  provider: AnalysisProvider;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseSynthesisResponse(
  payload: Record<string, unknown>,
): PolypharmacySynthesisResult | null {
  const summaryRaw = payload["summary"];
  const recommendationsRaw = payload["recommendations"];

  if (typeof summaryRaw !== "string") {
    return null;
  }

  return {
    summary: summaryRaw.trim(),
    recommendations: toStringArray(recommendationsRaw).slice(0, 8),
    provider: "rule-based",
  };
}

function buildRuleBasedSummary(
  input: PolypharmacySynthesisInput,
): PolypharmacySynthesisResult {
  const alertCount =
    input.beersFlags.length +
    input.duplicateTherapeuticClasses.length +
    input.deprescribingOpportunities.length;

  if (alertCount === 0) {
    return {
      provider: "rule-based",
      summary:
        "No significant polypharmacy safety alerts were detected from current Beers, class duplication, and burden rules.",
      recommendations: [
        "Continue periodic medication reconciliation.",
        "Re-evaluate regimen whenever new medications are introduced.",
      ],
    };
  }

  return {
    provider: "rule-based",
    summary: `Polypharmacy analysis identified ${alertCount} clinically relevant alert(s) with an overall ${input.riskLevel} risk profile.`,
    recommendations: [
      "Prioritize medications flagged by Beers criteria in older adults.",
      "Review duplicate therapeutic classes and discontinue redundant therapies when possible.",
      "Address high drug burden index contributors to reduce sedation and anticholinergic harm.",
    ],
  };
}

function buildPrompt(input: PolypharmacySynthesisInput): {
  system: string;
  user: string;
} {
  const system =
    "You are a clinical pharmacist focused on polypharmacy safety. Return only valid JSON with fields: summary (string), recommendations (string array). Keep recommendations specific and practical.";

  const user =
    `Patient age: ${input.patientAge}\n` +
    `Conditions: ${JSON.stringify(input.patientConditions)}\n` +
    `Current medications: ${JSON.stringify(input.currentMedications)}\n` +
    `Overall risk level: ${input.riskLevel}\n` +
    `Beers flags: ${JSON.stringify(input.beersFlags)}\n` +
    `Duplicate classes: ${JSON.stringify(input.duplicateTherapeuticClasses)}\n` +
    `Drug burden index: ${input.drugBurdenIndex}\n` +
    `Deprescribing opportunities: ${JSON.stringify(input.deprescribingOpportunities)}\n` +
    "Provide a concise summary and up to 5 recommendations suitable for clinical review.";

  return { system, user };
}

/**
 * Provider-fallback synthesis service for polypharmacy summaries.
 */
export class PolypharmacySynthesisService {
  public constructor(
    private readonly groqClient: GroqClient,
    private readonly geminiClient: GeminiClient,
    private readonly logger: Logger,
  ) {}

  public async synthesize(
    input: PolypharmacySynthesisInput,
  ): Promise<PolypharmacySynthesisResult> {
    const prompt = buildPrompt(input);

    if (this.groqClient.isConfigured()) {
      try {
        const response = await this.groqClient.generateStructuredJson(
          prompt.system,
          prompt.user,
        );
        const parsed = parseSynthesisResponse(response);
        if (parsed) {
          return {
            ...parsed,
            provider: "groq",
          };
        }

        this.logger.warn(
          "Groq polypharmacy synthesis returned unexpected schema.",
        );
      } catch (error) {
        this.logger.warn(
          "Groq polypharmacy synthesis failed; trying Gemini fallback.",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    if (this.geminiClient.isConfigured()) {
      try {
        const response = await this.geminiClient.generateStructuredJson(
          prompt.system,
          prompt.user,
        );
        const parsed = parseSynthesisResponse(response);
        if (parsed) {
          return {
            ...parsed,
            provider: "gemini",
          };
        }

        this.logger.warn(
          "Gemini polypharmacy synthesis returned unexpected schema.",
        );
      } catch (error) {
        this.logger.warn(
          "Gemini polypharmacy synthesis failed; using rule-based output.",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    return buildRuleBasedSummary(input);
  }
}

/**
 * Deterministic polypharmacy synthesis fallback.
 */
export class RuleOnlyPolypharmacySynthesisService {
  public async synthesize(
    input: PolypharmacySynthesisInput,
  ): Promise<PolypharmacySynthesisResult> {
    return buildRuleBasedSummary(input);
  }
}
