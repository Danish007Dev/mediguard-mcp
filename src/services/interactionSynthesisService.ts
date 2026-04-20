import { createHash } from "node:crypto";
import type { GeminiClient } from "../clients/geminiClient";
import type { GroqClient } from "../clients/groqClient";
import type { Logger } from "../logging/logger";
import type {
  InteractionFinding,
  InteractionPatientContext,
  LlmInteractionAnalysis,
  RiskLevel,
} from "../types/medicationSafety";
import { TtlCache } from "../utils/ttlCache";
import { z } from "zod";

export type AnalysisProvider = "groq" | "gemini" | "rule-based";

export interface InteractionSynthesisInput {
  medications: string[];
  interactions: InteractionFinding[];
  riskLevel: RiskLevel;
  patientContext?: InteractionPatientContext;
}

export interface InteractionSynthesisResult {
  summary: string;
  recommendations: string[];
  provider: AnalysisProvider;
  overallRisk: "low" | "moderate" | "high";
  interactionAnalyses: LlmInteractionAnalysis[];
}

interface PromptRawInteraction {
  drug1: string;
  drug2: string;
  severity_code: string;
  description: string;
}

const MAX_INTERACTIONS_FOR_PROMPT = 12;

const llmSeveritySchema = z.enum(["low", "moderate", "high"]);

const llmInteractionAnalysisSchema = z
  .object({
    drug1: z.string().trim().min(1),
    drug2: z.string().trim().min(1),
    severity: llmSeveritySchema,
    reasoning: z.string().trim().min(1),
    mechanism: z.string().trim().min(1),
    monitoringRecommendations: z.array(z.string().trim().min(1)).default([]),
    saferAlternatives: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((value, context) => {
    if (value.severity === "high" && value.saferAlternatives.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "High-risk analyses must include at least one safer alternative suggestion.",
      });
    }
  });

const llmSynthesisSchema = z.object({
  overallRisk: llmSeveritySchema,
  contextualizedSummary: z.string().trim().min(1),
  recommendations: z.array(z.string().trim().min(1)).default([]),
  interactionAnalyses: z.array(llmInteractionAnalysisSchema).default([]),
});

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function toUniqueList(values: string[]): string[] {
  const output = new Map<string, string>();

  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (!output.has(key)) {
      output.set(key, cleaned);
    }
  }

  return Array.from(output.values());
}

function mapRiskLevelToLlm(riskLevel: RiskLevel): "low" | "moderate" | "high" {
  if (riskLevel === "critical" || riskLevel === "high") {
    return "high";
  }

  if (riskLevel === "medium") {
    return "moderate";
  }

  return "low";
}

function mapInteractionSeverityToLlm(
  severity: InteractionFinding["severity"],
): "low" | "moderate" | "high" {
  if (severity === "major" || severity === "contraindicated") {
    return "high";
  }

  if (severity === "moderate") {
    return "moderate";
  }

  return "low";
}

function inferOverallRisk(
  analyses: LlmInteractionAnalysis[],
  fallbackRiskLevel: RiskLevel,
): "low" | "moderate" | "high" {
  if (analyses.some((analysis) => analysis.severity === "high")) {
    return "high";
  }

  if (analyses.some((analysis) => analysis.severity === "moderate")) {
    return "moderate";
  }

  return mapRiskLevelToLlm(fallbackRiskLevel);
}

function toPromptRawInteractions(
  interactions: InteractionFinding[],
): PromptRawInteraction[] {
  return interactions.slice(0, MAX_INTERACTIONS_FOR_PROMPT).map((interaction) => {
    const drug1 = interaction.drugs[0] ?? "unknown";
    const drug2 = interaction.drugs[1] ?? "unknown";

    return {
      drug1,
      drug2,
      severity_code: interaction.severity,
      description: normalizeWhitespace(
        `${interaction.mechanism}. ${interaction.clinicalImpact}`,
      ).slice(0, 600),
    };
  });
}

function buildPatientContextSummary(
  patientContext?: InteractionPatientContext,
): string {
  if (!patientContext) {
    return "No patient context provided.";
  }

  const ageText =
    typeof patientContext.age === "number"
      ? `Age ${patientContext.age}`
      : "Age unknown";
  const conditions =
    patientContext.conditions.length > 0
      ? patientContext.conditions.join(", ")
      : "No reported chronic conditions";
  const renalText = patientContext.renalFunction
    ? patientContext.renalFunction
    : "Renal function not provided";

  return `${ageText}; Conditions: ${conditions}; Renal: ${renalText}.`;
}

function parseSynthesisResponse(
  payload: Record<string, unknown>,
): z.infer<typeof llmSynthesisSchema> | null {
  const parsed = llmSynthesisSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function fallbackAlternativesForPair(drug1: string, drug2: string): string[] {
  const left = drug1.toLowerCase();
  const right = drug2.toLowerCase();

  if (
    (left.includes("warfarin") && right.includes("ibuprofen")) ||
    (left.includes("ibuprofen") && right.includes("warfarin"))
  ) {
    return [
      "Use acetaminophen when clinically appropriate instead of routine NSAID use.",
      "If anti-inflammatory therapy is required, consider alternatives with lower bleeding risk and tighter monitoring.",
    ];
  }

  return [
    "Consider a lower-interaction alternative from the same therapeutic class after pharmacist review.",
  ];
}

function buildRuleBasedSummary(
  input: InteractionSynthesisInput,
): InteractionSynthesisResult {
  const patientContextText = buildPatientContextSummary(input.patientContext);

  if (input.interactions.length === 0) {
    return {
      provider: "rule-based",
      summary:
        `No interaction evidence met rule thresholds. Continue routine medication safety review. ${patientContextText}`,
      recommendations: [
        "Continue standard monitoring and reassess if medication changes occur.",
        "Recheck interactions if new prescriptions are added.",
      ],
      overallRisk: "low",
      interactionAnalyses: [],
    };
  }

  const interactionAnalyses: LlmInteractionAnalysis[] = input.interactions.map(
    (interaction) => {
      const drug1 = interaction.drugs[0] ?? "unknown";
      const drug2 = interaction.drugs[1] ?? "unknown";
      const severity = mapInteractionSeverityToLlm(interaction.severity);

      return {
        drug1,
        drug2,
        severity,
        reasoning: interaction.clinicalImpact,
        mechanism: interaction.mechanism,
        monitoringRecommendations:
          interaction.recommendations.length > 0
            ? interaction.recommendations.slice(0, 5)
            : [
                "Increase monitoring frequency and reassess symptoms after medication changes.",
              ],
        saferAlternatives:
          severity === "high" ? fallbackAlternativesForPair(drug1, drug2) : [],
      };
    },
  );

  const overallRisk = inferOverallRisk(interactionAnalyses, input.riskLevel);
  const highRiskCount = interactionAnalyses.filter(
    (analysis) => analysis.severity === "high",
  ).length;
  const recommendations = toUniqueList([
    ...interactionAnalyses.flatMap(
      (analysis) => analysis.monitoringRecommendations,
    ),
    ...interactionAnalyses
      .filter((analysis) => analysis.severity === "high")
      .flatMap((analysis) => analysis.saferAlternatives),
  ]).slice(0, 8);

  return {
    provider: "rule-based",
    summary:
      `Detected ${input.interactions.length} potential interaction(s), including ${highRiskCount} high-severity finding(s). ` +
      `Patient context considered: ${patientContextText}`,
    recommendations,
    overallRisk,
    interactionAnalyses,
  };
}

function buildPrompt(input: InteractionSynthesisInput): {
  system: string;
  user: string;
} {
  const rawInteractions = toPromptRawInteractions(input.interactions);
  const patientContext = {
    age: input.patientContext?.age,
    conditions: input.patientContext?.conditions ?? [],
    renal_function: input.patientContext?.renalFunction,
  };

  const system =
    "You are a clinical pharmacist AI. Return only valid JSON with keys: overallRisk, contextualizedSummary, recommendations, interactionAnalyses. " +
    "Each interactionAnalyses item must include drug1, drug2, severity (high|moderate|low), reasoning, mechanism, monitoringRecommendations, saferAlternatives. " +
    "If severity is high, saferAlternatives must include at least one concrete option.";

  const user =
    `Drug list: ${JSON.stringify(input.medications)}\n` +
    `Raw interactions: ${JSON.stringify(rawInteractions)}\n` +
    `Patient context: ${JSON.stringify(patientContext)}\n` +
    `Baseline risk level: ${mapRiskLevelToLlm(input.riskLevel)}\n` +
    "Tasks:\n" +
    "1. Analyze severity (High/Moderate/Low) with reasoning.\n" +
    "2. Explain mechanism of interaction in clinical terms.\n" +
    "3. Provide monitoring recommendations.\n" +
    "4. Suggest safer alternatives if high risk.\n" +
    "5. Adapt explanation based on age, conditions, and renal function.\n" +
    "6. Keep output concise and deterministic for machine parsing.";

  return { system, user };
}

function toCacheKey(input: InteractionSynthesisInput): string {
  const rawInteractions = toPromptRawInteractions(input.interactions);
  const normalized = {
    medications: toUniqueList(input.medications.map((item) => item.toLowerCase())),
    rawInteractions,
    riskLevel: input.riskLevel,
    patientContext: {
      age: input.patientContext?.age,
      conditions: toUniqueList(
        (input.patientContext?.conditions ?? []).map((item) => item.toLowerCase()),
      ),
      renalFunction: input.patientContext?.renalFunction ?? "",
    },
  };

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function finalizeParsedResult(
  parsed: z.infer<typeof llmSynthesisSchema>,
  input: InteractionSynthesisInput,
): InteractionSynthesisResult {
  const fallback = buildRuleBasedSummary(input);
  const parsedAnalyses = parsed.interactionAnalyses.slice(
    0,
    MAX_INTERACTIONS_FOR_PROMPT,
  );

  const interactionAnalyses =
    parsedAnalyses.length > 0 ? parsedAnalyses : fallback.interactionAnalyses;

  const recommendations = toUniqueList([
    ...parsed.recommendations,
    ...interactionAnalyses.flatMap(
      (analysis) => analysis.monitoringRecommendations,
    ),
    ...interactionAnalyses
      .filter((analysis) => analysis.severity === "high")
      .flatMap((analysis) => analysis.saferAlternatives),
  ]).slice(0, 8);

  return {
    provider: "rule-based",
    summary: normalizeWhitespace(parsed.contextualizedSummary),
    recommendations,
    overallRisk: inferOverallRisk(interactionAnalyses, input.riskLevel),
    interactionAnalyses,
  };
}

/**
 * Provider-fallback synthesis service for interaction summaries and recommendations.
 */
export class InteractionSynthesisService {
  private readonly synthesisCache = new TtlCache<string, InteractionSynthesisResult>(
    10 * 60 * 1000,
  );

  public constructor(
    private readonly groqClient: GroqClient,
    private readonly geminiClient: GeminiClient,
    private readonly logger: Logger,
  ) {}

  public async synthesize(
    input: InteractionSynthesisInput,
  ): Promise<InteractionSynthesisResult> {
    if (input.interactions.length === 0) {
      return buildRuleBasedSummary(input);
    }

    const trimmedInput: InteractionSynthesisInput = {
      ...input,
      interactions: input.interactions.slice(0, MAX_INTERACTIONS_FOR_PROMPT),
    };

    const cacheKey = toCacheKey(trimmedInput);
    const cached = this.synthesisCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const prompt = buildPrompt(trimmedInput);

    if (this.groqClient.isConfigured()) {
      try {
        const response = await this.groqClient.generateStructuredJson(
          prompt.system,
          prompt.user,
        );
        const parsed = parseSynthesisResponse(response);
        if (parsed) {
          const finalized = finalizeParsedResult(parsed, trimmedInput);
          const result = {
            ...finalized,
            provider: "groq" as const,
          };

          this.synthesisCache.set(cacheKey, result);
          return result;
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
          const finalized = finalizeParsedResult(parsed, trimmedInput);
          const result = {
            ...finalized,
            provider: "gemini" as const,
          };

          this.synthesisCache.set(cacheKey, result);
          return result;
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

    const fallback = buildRuleBasedSummary(trimmedInput);
    this.synthesisCache.set(cacheKey, fallback);
    return fallback;
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
