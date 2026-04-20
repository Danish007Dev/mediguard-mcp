import type { GeminiClient } from "../clients/geminiClient";
import type { GroqClient } from "../clients/groqClient";
import type { Logger } from "../logging/logger";
import type {
  ContraindicationFinding,
  RiskLevel,
} from "../types/medicationSafety";

type AnalysisProvider = "groq" | "gemini" | "rule-based";

export interface ContraindicationSynthesisInput {
  proposedMedication: string;
  patientAllergies: string[];
  patientConditions: string[];
  normalizedLabs: Record<string, number>;
  riskLevel: RiskLevel;
  contraindications: ContraindicationFinding[];
}

export interface ContraindicationSynthesisResult {
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
): ContraindicationSynthesisResult | null {
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
  input: ContraindicationSynthesisInput,
): ContraindicationSynthesisResult {
  if (input.contraindications.length === 0) {
    return {
      provider: "rule-based",
      summary:
        "No contraindications were detected from available allergy, condition, lab, and label rule checks.",
      recommendations: [
        "Proceed with standard prescribing workflow and routine monitoring.",
        "Reassess contraindications when medication list, labs, or conditions change.",
      ],
    };
  }

  const contraindicatedCount = input.contraindications.filter(
    (finding) => finding.severity === "contraindicated",
  ).length;

  const majorCount = input.contraindications.filter(
    (finding) => finding.severity === "major",
  ).length;

  return {
    provider: "rule-based",
    summary:
      `Contraindication analysis found ${input.contraindications.length} finding(s), including ` +
      `${contraindicatedCount} contraindicated and ${majorCount} major risk finding(s).`,
    recommendations: [
      "Avoid or replace contraindicated therapies before prescribing.",
      "Use the lowest effective dose with close follow-up when only cautionary findings are present.",
      "Document allergy history and lab-based rationale for medication choice.",
    ],
  };
}

function buildPrompt(input: ContraindicationSynthesisInput): {
  system: string;
  user: string;
} {
  const system =
    "You are a clinical pharmacist focused on contraindication safety checks. Return only valid JSON with keys: summary (string), recommendations (string array).";

  const user =
    `Proposed medication: ${input.proposedMedication}\n` +
    `Patient allergies: ${JSON.stringify(input.patientAllergies)}\n` +
    `Patient conditions: ${JSON.stringify(input.patientConditions)}\n` +
    `Labs: ${JSON.stringify(input.normalizedLabs)}\n` +
    `Risk level: ${input.riskLevel}\n` +
    `Contraindication findings: ${JSON.stringify(input.contraindications)}\n` +
    "Provide a concise safety summary and up to 5 actionable recommendations.";

  return { system, user };
}

/**
 * Provider-fallback synthesis service for contraindication summary generation.
 */
export class ContraindicationSynthesisService {
  public constructor(
    private readonly groqClient: GroqClient,
    private readonly geminiClient: GeminiClient,
    private readonly logger: Logger,
  ) {}

  public async synthesize(
    input: ContraindicationSynthesisInput,
  ): Promise<ContraindicationSynthesisResult> {
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
          "Groq contraindication synthesis returned unexpected schema.",
        );
      } catch (error) {
        this.logger.warn(
          "Groq contraindication synthesis failed; trying Gemini fallback.",
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
          "Gemini contraindication synthesis returned unexpected schema.",
        );
      } catch (error) {
        this.logger.warn(
          "Gemini contraindication synthesis failed; using rule-based output.",
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
 * Deterministic contraindication synthesis fallback.
 */
export class RuleOnlyContraindicationSynthesisService {
  public async synthesize(
    input: ContraindicationSynthesisInput,
  ): Promise<ContraindicationSynthesisResult> {
    return buildRuleBasedSummary(input);
  }
}
