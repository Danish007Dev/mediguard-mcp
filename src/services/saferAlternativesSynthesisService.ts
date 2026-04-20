import { createHash } from "node:crypto";
import type { GeminiClient } from "../clients/geminiClient";
import type { GroqClient } from "../clients/groqClient";
import type { Logger } from "../logging/logger";
import type {
  InteractionLlmTelemetry,
  InteractionLlmTrace,
} from "../types/medicationSafety";
import type {
  RiskLevel,
  SaferAlternativeOption,
} from "../types/medicationSafety";
import { TtlCache } from "../utils/ttlCache";
import { LlmSynthesisObservability } from "./llmSynthesisObservability";

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
  trace?: InteractionLlmTrace;
  telemetry?: InteractionLlmTelemetry;
}

interface SaferAlternativesSynthesisCoreResult {
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
): SaferAlternativesSynthesisCoreResult | null {
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
): SaferAlternativesSynthesisCoreResult {
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

function toCacheKey(input: SaferAlternativesSynthesisInput): string {
  const normalized = {
    proposedMedication: input.proposedMedication.toLowerCase(),
    riskLevel: input.riskLevel,
    riskContext: [...input.riskContext].map((item) => item.toLowerCase()).sort(),
    alternatives: input.alternatives.map((option) => ({
      medication: option.medication.toLowerCase(),
      therapeuticClass: option.therapeuticClass,
      safetyScore: option.safetyScore,
      formularyPreferred: option.formularyPreferred,
      avoidsRisks: option.avoidsRisks,
      cautionFlags: option.cautionFlags,
      rationale: option.rationale,
    })),
  };

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
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
  private readonly cache = new TtlCache<string, SaferAlternativesSynthesisCoreResult>(
    10 * 60 * 1000,
  );
  private readonly observability: LlmSynthesisObservability;

  public constructor(
    private readonly groqClient: GroqClient,
    private readonly geminiClient: GeminiClient,
    private readonly logger: Logger,
  ) {
    this.observability = new LlmSynthesisObservability(
      this.logger,
      "safer-alternatives-synthesis",
    );
  }

  public async synthesize(
    input: SaferAlternativesSynthesisInput,
  ): Promise<SaferAlternativesSynthesisResult> {
    const traceId = this.observability.startRequest();
    const attemptedProviders: AnalysisProvider[] = [];
    const promptItemCount = input.alternatives.length;
    const cacheKey = toCacheKey(input);
    const cached = this.cache.get(cacheKey);

    if (cached) {
      this.observability.markCacheHit();
      const trace = this.observability.buildTrace({
        traceId,
        cacheHit: true,
        attemptedProviders: [cached.provider],
        selectedProvider: cached.provider,
        fallbackUsed: false,
        promptItemCount,
        contextSignals: {
          age: false,
          conditions: input.riskContext.length > 0,
          renalFunction: false,
        },
      });

      return {
        ...cached,
        trace,
        telemetry: this.observability.snapshotTelemetry(),
      };
    }

    const prompt = buildPrompt(input);

    if (this.groqClient.isConfigured()) {
      attemptedProviders.push("groq");
      this.observability.recordProviderAttempt("groq");

      try {
        const response = await this.groqClient.generateStructuredJson(
          prompt.system,
          prompt.user,
        );
        const parsed = parseSynthesisResponse(response);
        if (parsed) {
          this.observability.recordTokenEstimate(
            "groq",
            prompt.system,
            prompt.user,
            response,
          );
          const result: SaferAlternativesSynthesisCoreResult = {
            ...parsed,
            provider: "groq",
          };
          this.cache.set(cacheKey, result);

          const trace = this.observability.buildTrace({
            traceId,
            cacheHit: false,
            attemptedProviders,
            selectedProvider: "groq",
            fallbackUsed: false,
            promptItemCount,
            contextSignals: {
              age: false,
              conditions: input.riskContext.length > 0,
              renalFunction: false,
            },
          });

          return {
            ...result,
            trace,
            telemetry: this.observability.snapshotTelemetry(),
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
      attemptedProviders.push("gemini");
      this.observability.recordProviderAttempt("gemini");

      try {
        const response = await this.geminiClient.generateStructuredJson(
          prompt.system,
          prompt.user,
        );
        const parsed = parseSynthesisResponse(response);
        if (parsed) {
          this.observability.recordTokenEstimate(
            "gemini",
            prompt.system,
            prompt.user,
            response,
          );
          const result: SaferAlternativesSynthesisCoreResult = {
            ...parsed,
            provider: "gemini",
          };
          this.cache.set(cacheKey, result);

          const trace = this.observability.buildTrace({
            traceId,
            cacheHit: false,
            attemptedProviders,
            selectedProvider: "gemini",
            fallbackUsed: attemptedProviders.includes("groq"),
            promptItemCount,
            contextSignals: {
              age: false,
              conditions: input.riskContext.length > 0,
              renalFunction: false,
            },
          });

          return {
            ...result,
            trace,
            telemetry: this.observability.snapshotTelemetry(),
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

    attemptedProviders.push("rule-based");
    this.observability.recordProviderAttempt("rule-based");

    const result = buildRuleBasedSummary(input);
    this.cache.set(cacheKey, result);

    const trace = this.observability.buildTrace({
      traceId,
      cacheHit: false,
      attemptedProviders,
      selectedProvider: "rule-based",
      fallbackUsed: attemptedProviders.length > 1,
      promptItemCount,
      contextSignals: {
        age: false,
        conditions: input.riskContext.length > 0,
        renalFunction: false,
      },
    });

    return {
      ...result,
      trace,
      telemetry: this.observability.snapshotTelemetry(),
    };
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
