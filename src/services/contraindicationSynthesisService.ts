import { createHash } from "node:crypto";
import type { GeminiClient } from "../clients/geminiClient";
import type { GroqClient } from "../clients/groqClient";
import type { Logger } from "../logging/logger";
import type {
  InteractionLlmTelemetry,
  InteractionLlmTrace,
} from "../types/medicationSafety";
import type {
  ContraindicationFinding,
  RiskLevel,
} from "../types/medicationSafety";
import { TtlCache } from "../utils/ttlCache";
import { LlmSynthesisObservability } from "./llmSynthesisObservability";

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
  trace?: InteractionLlmTrace;
  telemetry?: InteractionLlmTelemetry;
}

interface ContraindicationSynthesisCoreResult {
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
): ContraindicationSynthesisCoreResult | null {
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
): ContraindicationSynthesisCoreResult {
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

function toCacheKey(input: ContraindicationSynthesisInput): string {
  const normalized = {
    proposedMedication: input.proposedMedication.toLowerCase(),
    patientAllergies: [...input.patientAllergies]
      .map((entry) => entry.toLowerCase())
      .sort(),
    patientConditions: [...input.patientConditions]
      .map((entry) => entry.toLowerCase())
      .sort(),
    normalizedLabs: Object.entries(input.normalizedLabs)
      .map(([key, value]) => [key.toLowerCase(), value] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
    riskLevel: input.riskLevel,
    contraindications: input.contraindications.map((finding) => ({
      medication: finding.medication.toLowerCase(),
      trigger: finding.trigger,
      severity: finding.severity,
      rationale: finding.rationale,
      recommendation: finding.recommendation,
      evidence: finding.evidence,
      source: finding.source,
    })),
  };

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
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
  private readonly cache = new TtlCache<string, ContraindicationSynthesisCoreResult>(
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
      "contraindication-synthesis",
    );
  }

  public async synthesize(
    input: ContraindicationSynthesisInput,
  ): Promise<ContraindicationSynthesisResult> {
    const traceId = this.observability.startRequest();
    const attemptedProviders: AnalysisProvider[] = [];
    const promptItemCount = input.contraindications.length;
    const contextSignals = {
      age: false,
      conditions: input.patientConditions.length > 0,
      renalFunction: Object.keys(input.normalizedLabs).length > 0,
    };
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
        contextSignals,
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
          const result: ContraindicationSynthesisCoreResult = {
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
            contextSignals,
          });

          return {
            ...result,
            trace,
            telemetry: this.observability.snapshotTelemetry(),
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
          const result: ContraindicationSynthesisCoreResult = {
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
            contextSignals,
          });

          return {
            ...result,
            trace,
            telemetry: this.observability.snapshotTelemetry(),
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
      contextSignals,
    });

    return {
      ...result,
      trace,
      telemetry: this.observability.snapshotTelemetry(),
    };
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
