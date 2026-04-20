import { createHash } from "node:crypto";
import type { GeminiClient } from "../clients/geminiClient";
import type { GroqClient } from "../clients/groqClient";
import type { Logger } from "../logging/logger";
import type {
  InteractionLlmTelemetry,
  InteractionLlmTrace,
  MedicationSafetyExplanationFinding,
  RiskLevel,
} from "../types/medicationSafety";
import { TtlCache } from "../utils/ttlCache";
import { LlmSynthesisObservability } from "./llmSynthesisObservability";

type AnalysisProvider = "groq" | "gemini" | "rule-based";

export interface MedicationSafetyExplanationSynthesisInput {
  audience: "patient" | "provider";
  language: string;
  medication: string;
  riskLevel: RiskLevel;
  findings: MedicationSafetyExplanationFinding[];
  recommendations: string[];
}

export interface MedicationSafetyExplanationSynthesisResult {
  headline: string;
  explanation: string;
  keyPoints: string[];
  followUpQuestions: string[];
  disclaimer: string;
  provider: AnalysisProvider;
  trace?: InteractionLlmTrace;
  telemetry?: InteractionLlmTelemetry;
}

interface MedicationSafetyExplanationSynthesisCoreResult {
  headline: string;
  explanation: string;
  keyPoints: string[];
  followUpQuestions: string[];
  disclaimer: string;
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
): MedicationSafetyExplanationSynthesisCoreResult | null {
  const headlineRaw = payload["headline"];
  const explanationRaw = payload["explanation"];
  const keyPointsRaw = payload["keyPoints"];
  const followUpQuestionsRaw = payload["followUpQuestions"];
  const disclaimerRaw = payload["disclaimer"];

  if (
    typeof headlineRaw !== "string" ||
    typeof explanationRaw !== "string" ||
    typeof disclaimerRaw !== "string"
  ) {
    return null;
  }

  return {
    headline: headlineRaw.trim(),
    explanation: explanationRaw.trim(),
    keyPoints: toStringArray(keyPointsRaw).slice(0, 8),
    followUpQuestions: toStringArray(followUpQuestionsRaw).slice(0, 8),
    disclaimer: disclaimerRaw.trim(),
    /**
     * Provider-fallback synthesis service for patient/provider explanation text.
     */
    provider: "rule-based",
  };
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function simplifyClinicalText(text: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/contraindicated/gi, "not safe to use"],
    [/hemorrhage/gi, "serious bleeding"],
    [/gastrointestinal/gi, "stomach and bowel"],
    [/renal/gi, "kidney"],
    [/hepatic/gi, "liver"],
    [/nephrotoxicity/gi, "kidney harm"],
    [/hypotension/gi, "low blood pressure"],
    [/tachycardia/gi, "fast heart rate"],
    [/adverse event/gi, "side effect"],
  ];

  let output = text;
  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }

  return normalizeWhitespace(output);
}

function buildPatientFallback(
  input: MedicationSafetyExplanationSynthesisInput,
): MedicationSafetyExplanationSynthesisCoreResult {
  const topFindings = input.findings.slice(0, 3);

  const keyPoints = topFindings.map((finding) => {
    const impact = simplifyClinicalText(finding.clinicalImpact);
    return `${finding.issue}: ${impact}.`;
  });

  if (keyPoints.length === 0) {
    keyPoints.push(
      "No major medicine safety problems were detected from the available information.",
    );
  }

  const followUpQuestions = [
    `What warning signs should I watch for if I take ${input.medication}?`,
    "When should I call my clinic or pharmacist right away?",
    "Are there safer options for me based on my health conditions?",
  ];

  const actionableRecommendations = input.recommendations
    .slice(0, 3)
    .map((item) => simplifyClinicalText(item));

  const explanationParts = [
    `${input.medication} has an overall ${input.riskLevel} safety risk in your case.`,
    ...keyPoints.map((point) => simplifyClinicalText(point)),
    ...actionableRecommendations.map((item) => `Next step: ${item}`),
  ];

  return {
    headline: `Safety summary for ${input.medication}`,
    explanation: explanationParts.join(" "),
    keyPoints,
    followUpQuestions,
    disclaimer:
      "This summary helps with education, but it does not replace advice from your doctor or pharmacist.",
    provider: "rule-based",
  };
  /**
   * Deterministic explanation synthesis fallback for reliability.
   */
}

function buildProviderFallback(
  input: MedicationSafetyExplanationSynthesisInput,
): MedicationSafetyExplanationSynthesisCoreResult {
  const keyPoints = input.findings.slice(0, 5).map((finding) => {
    return `${finding.severity.toUpperCase()}: ${finding.issue} - ${finding.clinicalImpact}`;
  });

  if (keyPoints.length === 0) {
    keyPoints.push(
      "No high-confidence findings supplied; explanation generated from risk-level metadata only.",
    );
  }

  const followUpQuestions = [
    "Is there indication-concordant lower-risk therapy for this patient profile?",
    "Do current renal/hepatic function and comorbidity status support dose adjustment?",
    "What monitoring interval best mitigates foreseeable adverse outcomes?",
  ];

  const recommendations = input.recommendations.slice(0, 4);

  const explanationParts = [
    `${input.medication} is categorized as ${input.riskLevel} risk for this request context.`,
    ...keyPoints,
    ...recommendations.map((item) => `Recommended mitigation: ${item}`),
  ];

  return {
    headline: `Clinical safety rationale for ${input.medication}`,
    explanation: explanationParts.join(" "),
    keyPoints,
    followUpQuestions,
    disclaimer:
      "Clinical judgment, guideline review, and patient-specific assessment remain required before prescribing decisions.",
    provider: "rule-based",
  };
}

function buildRuleBasedSummary(
  input: MedicationSafetyExplanationSynthesisInput,
): MedicationSafetyExplanationSynthesisCoreResult {
  if (input.audience === "patient") {
    return buildPatientFallback(input);
  }

  return buildProviderFallback(input);
}

function toCacheKey(input: MedicationSafetyExplanationSynthesisInput): string {
  const normalized = {
    audience: input.audience,
    language: input.language.toLowerCase(),
    medication: input.medication.toLowerCase(),
    riskLevel: input.riskLevel,
    findings: input.findings.map((finding) => ({
      issue: finding.issue,
      severity: finding.severity,
      clinicalImpact: finding.clinicalImpact,
      recommendedAction: finding.recommendedAction,
    })),
    recommendations: input.recommendations,
  };

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function buildPrompt(input: MedicationSafetyExplanationSynthesisInput): {
  system: string;
  user: string;
} {
  const audienceInstruction =
    input.audience === "patient"
      ? "Write at approximately grade-8 readability with short sentences and minimal jargon."
      : "Use concise clinical language suitable for a prescribing clinician.";

  const system =
    "You are a medication safety communication specialist. Return only valid JSON with keys: headline (string), explanation (string), keyPoints (string array), followUpQuestions (string array), disclaimer (string).";

  const user =
    `Audience: ${input.audience}\n` +
    `Language: ${input.language}\n` +
    `${audienceInstruction}\n` +
    `Medication: ${input.medication}\n` +
    `Risk level: ${input.riskLevel}\n` +
    `Findings: ${JSON.stringify(input.findings)}\n` +
    `Recommendations: ${JSON.stringify(input.recommendations)}\n` +
    "Provide a clear explanation with actionable follow-up prompts.";

  return { system, user };
}

export class MedicationSafetyExplanationSynthesisService {
  private readonly cache = new TtlCache<
    string,
    MedicationSafetyExplanationSynthesisCoreResult
  >(10 * 60 * 1000);
  private readonly observability: LlmSynthesisObservability;

  public constructor(
    private readonly groqClient: GroqClient,
    private readonly geminiClient: GeminiClient,
    private readonly logger: Logger,
  ) {
    this.observability = new LlmSynthesisObservability(
      this.logger,
      "medication-explanation-synthesis",
    );
  }

  public async synthesize(
    input: MedicationSafetyExplanationSynthesisInput,
  ): Promise<MedicationSafetyExplanationSynthesisResult> {
    const traceId = this.observability.startRequest();
    const attemptedProviders: AnalysisProvider[] = [];
    const promptItemCount = input.findings.length;
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
          const result: MedicationSafetyExplanationSynthesisCoreResult = {
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
          });

          return {
            ...result,
            trace,
            telemetry: this.observability.snapshotTelemetry(),
          };
        }

        this.logger.warn(
          "Groq medication-explanation synthesis returned unexpected schema.",
        );
      } catch (error) {
        this.logger.warn(
          "Groq medication-explanation synthesis failed; trying Gemini fallback.",
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
          const result: MedicationSafetyExplanationSynthesisCoreResult = {
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
          });

          return {
            ...result,
            trace,
            telemetry: this.observability.snapshotTelemetry(),
          };
        }

        this.logger.warn(
          "Gemini medication-explanation synthesis returned unexpected schema.",
        );
      } catch (error) {
        this.logger.warn(
          "Gemini medication-explanation synthesis failed; using rule-based output.",
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
    });

    return {
      ...result,
      trace,
      telemetry: this.observability.snapshotTelemetry(),
    };
  }
}

export class RuleOnlyMedicationSafetyExplanationSynthesisService {
  public async synthesize(
    input: MedicationSafetyExplanationSynthesisInput,
  ): Promise<MedicationSafetyExplanationSynthesisResult> {
    return buildRuleBasedSummary(input);
  }
}
