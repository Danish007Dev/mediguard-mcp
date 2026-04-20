import type { GeminiClient } from "../clients/geminiClient";
import type { GroqClient } from "../clients/groqClient";
import type { Logger } from "../logging/logger";
import type { InteractionFinding, RiskLevel } from "../types/medicationSafety";

export type AnalysisProvider = "groq" | "gemini" | "rule-based";

export interface InteractionSynthesisInput {
  medications: string[];
  interactions: InteractionFinding[];
  riskLevel: RiskLevel;
}

export interface InteractionSynthesisResult {
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
): InteractionSynthesisResult | null {
  const summaryRaw = payload["summary"];
  const recommendationsRaw = payload["recommendations"];

  if (typeof summaryRaw !== "string") {
    return null;
  }

  const recommendations = toStringArray(recommendationsRaw).slice(0, 8);

  return {
    summary: summaryRaw.trim(),
    recommendations,
    provider: "rule-based",
  };
}

function buildRuleBasedSummary(
  input: InteractionSynthesisInput,
): InteractionSynthesisResult {
  if (input.interactions.length === 0) {
    return {
      provider: "rule-based",
      summary:
        "No interaction evidence met rule thresholds. Continue routine medication safety review.",
      recommendations: [
        "Continue standard monitoring and reassess if medication changes occur.",
        "Recheck interactions if new prescriptions are added.",
      ],
    };
  }

  const majorCount = input.interactions.filter(
    (interaction) =>
      interaction.severity === "major" ||
      interaction.severity === "contraindicated",
  ).length;

  return {
    provider: "rule-based",
    summary: `Detected ${input.interactions.length} potential interaction(s), including ${majorCount} high-severity finding(s).`,
    recommendations: [
      "Prioritize review of contraindicated and major interactions.",
      "Consider safer alternatives for NSAID and anticoagulant combinations where appropriate.",
      "Document monitoring plan for bleeding, toxicity, or dose-related adverse events.",
    ],
  };
}

function buildPrompt(input: InteractionSynthesisInput): {
  system: string;
  user: string;
} {
  const system =
    "You are a clinical medication safety analyst. Return only valid JSON with fields: summary (string), recommendations (string array). Keep recommendations actionable and concise.";

  const user =
    `Medication list: ${JSON.stringify(input.medications)}\n` +
    `Risk level: ${input.riskLevel}\n` +
    `Interactions: ${JSON.stringify(input.interactions)}\n` +
    "Write a concise clinical summary and up to 5 actionable monitoring or mitigation recommendations.";

  return { system, user };
}

/**
 * Provider-fallback synthesis service for interaction summaries and recommendations.
 */
export class InteractionSynthesisService {
  public constructor(
    private readonly groqClient: GroqClient,
    private readonly geminiClient: GeminiClient,
    private readonly logger: Logger,
  ) {}

  public async synthesize(
    input: InteractionSynthesisInput,
  ): Promise<InteractionSynthesisResult> {
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
          "Groq synthesis returned unexpected schema; continuing to fallback.",
        );
      } catch (error) {
        this.logger.warn("Groq synthesis failed; trying Gemini fallback.", {
          error: error instanceof Error ? error.message : String(error),
        });
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
          "Gemini synthesis returned unexpected schema; using rule-based output.",
        );
      } catch (error) {
        this.logger.warn("Gemini synthesis failed; using rule-based output.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return buildRuleBasedSummary(input);
  }
}

/**
 * Deterministic synthesis fallback used when external LLM providers are unavailable.
 */
export class RuleOnlyInteractionSynthesisService {
  public async synthesize(
    input: InteractionSynthesisInput,
  ): Promise<InteractionSynthesisResult> {
    return buildRuleBasedSummary(input);
  }
}
