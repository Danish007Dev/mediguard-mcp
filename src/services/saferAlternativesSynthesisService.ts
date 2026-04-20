import type { GeminiClient } from "../clients/geminiClient";
import type { GroqClient } from "../clients/groqClient";
import type { Logger } from "../logging/logger";
import type {
  RiskLevel,
  SaferAlternativeOption,
} from "../types/medicationSafety";

type AnalysisProvider = "groq" | "gemini" | "rule-based";

export interface SaferAlternativesSynthesisInput {
  proposedMedication: string;
  riskLevel: RiskLevel;
  riskContext: string[];
  alternatives: SaferAlternativeOption[];
}

export interface SaferAlternativesSynthesisResult {
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
): SaferAlternativesSynthesisResult | null {
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
  input: SaferAlternativesSynthesisInput,
): SaferAlternativesSynthesisResult {
  if (input.alternatives.length === 0) {
    return {
      provider: "rule-based",
      summary:
        "No strong safer alternatives met ranking thresholds for this request. Consider specialist review or indication-specific guidance.",
      recommendations: [
        "Re-evaluate indication and non-pharmacologic options where appropriate.",
        "Review local formulary and patient-specific contraindications before selecting an alternative.",
      ],
    };
  }

  const topOption = input.alternatives[0];
  const topText = topOption
    ? `${topOption.medication} (score ${topOption.safetyScore})`
    : "no ranked option";

  return {
    provider: "rule-based",
    summary:
      `Identified ${input.alternatives.length} candidate alternative(s) for ${input.proposedMedication}. ` +
      `Top-ranked option: ${topText}.`,
    recommendations: [
      "Prioritize higher safety-score alternatives after confirming indication fit.",
      "Use formulary-preferred options when clinically equivalent and safe.",
      "Document rationale for selected alternative and planned follow-up monitoring.",
    ],
  };
}

function buildPrompt(input: SaferAlternativesSynthesisInput): {
  system: string;
  user: string;
} {
  const system =
    "You are a clinical pharmacist generating safer medication alternative recommendations. Return only valid JSON with keys: summary (string), recommendations (string array).";

  const user =
    `Proposed medication: ${input.proposedMedication}\n` +
    `Risk level: ${input.riskLevel}\n` +
    `Risk context: ${JSON.stringify(input.riskContext)}\n` +
    `Ranked alternatives: ${JSON.stringify(input.alternatives)}\n` +
    "Provide a concise summary and up to 5 actionable recommendations.";

  return { system, user };
}

/**
 * Provider-fallback synthesis service for safer-alternative summaries.
 */
export class SaferAlternativesSynthesisService {
  public constructor(
    private readonly groqClient: GroqClient,
    private readonly geminiClient: GeminiClient,
    private readonly logger: Logger,
  ) {}

  public async synthesize(
    input: SaferAlternativesSynthesisInput,
  ): Promise<SaferAlternativesSynthesisResult> {
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
          "Groq safer-alternatives synthesis returned unexpected schema.",
        );
      } catch (error) {
        this.logger.warn(
          "Groq safer-alternatives synthesis failed; trying Gemini fallback.",
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
          "Gemini safer-alternatives synthesis returned unexpected schema.",
        );
      } catch (error) {
        this.logger.warn(
          "Gemini safer-alternatives synthesis failed; using rule-based output.",
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
 * Deterministic safer-alternative synthesis fallback.
 */
export class RuleOnlySaferAlternativesSynthesisService {
  public async synthesize(
    input: SaferAlternativesSynthesisInput,
  ): Promise<SaferAlternativesSynthesisResult> {
    return buildRuleBasedSummary(input);
  }
}
