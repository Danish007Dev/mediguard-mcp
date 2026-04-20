import { randomUUID } from "node:crypto";
import type { Logger } from "../logging/logger";
import type {
  InteractionLlmTelemetry,
  InteractionLlmTrace,
} from "../types/medicationSafety";

export type SynthesisProvider = "groq" | "gemini" | "rule-based";

interface ProviderCallCounters {
  groq: number;
  gemini: number;
  ruleBased: number;
}

interface TraceContextSignals {
  age: boolean;
  conditions: boolean;
  renalFunction: boolean;
}

export interface BuildSynthesisTraceInput {
  traceId: string;
  cacheHit: boolean;
  attemptedProviders: SynthesisProvider[];
  selectedProvider: SynthesisProvider;
  fallbackUsed: boolean;
  promptItemCount: number;
  contextSignals?: Partial<TraceContextSignals>;
}

const APPROX_CHARS_PER_TOKEN = 4;

const ESTIMATED_COST_PER_1K_TOKENS_USD = {
  groq: 0.0012,
  gemini: 0.001,
} as const;

function estimateTokensFromText(value: string): number {
  const length = value.trim().length;
  if (length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(length / APPROX_CHARS_PER_TOKEN));
}

function asUniqueProviders(
  providers: SynthesisProvider[],
): SynthesisProvider[] {
  const seen = new Set<SynthesisProvider>();
  const output: SynthesisProvider[] = [];

  for (const provider of providers) {
    if (!seen.has(provider)) {
      seen.add(provider);
      output.push(provider);
    }
  }

  return output;
}

/**
 * Tracks synthesis-level trace metadata and cumulative telemetry counters.
 */
export class LlmSynthesisObservability {
  private totalRequests = 0;
  private cacheHits = 0;
  private providerCalls: ProviderCallCounters = {
    groq: 0,
    gemini: 0,
    ruleBased: 0,
  };
  private estimatedPromptTokens = 0;
  private estimatedCompletionTokens = 0;
  private estimatedSpendUsd = 0;

  public constructor(
    private readonly logger: Logger,
    private readonly componentName: string,
  ) {}

  public startRequest(): string {
    this.totalRequests += 1;
    return randomUUID();
  }

  public markCacheHit(): void {
    this.cacheHits += 1;
  }

  public recordProviderAttempt(provider: SynthesisProvider): void {
    if (provider === "rule-based") {
      this.providerCalls.ruleBased += 1;
      return;
    }

    this.providerCalls[provider] += 1;
  }

  public recordTokenEstimate(
    provider: "groq" | "gemini",
    promptSystem: string,
    promptUser: string,
    providerPayload: Record<string, unknown>,
  ): void {
    const promptTokens =
      estimateTokensFromText(promptSystem) + estimateTokensFromText(promptUser);
    const completionTokens = estimateTokensFromText(
      JSON.stringify(providerPayload),
    );

    this.estimatedPromptTokens += promptTokens;
    this.estimatedCompletionTokens += completionTokens;

    const tokenCostUsd =
      ((promptTokens + completionTokens) / 1000) *
      ESTIMATED_COST_PER_1K_TOKENS_USD[provider];
    this.estimatedSpendUsd += tokenCostUsd;
  }

  public buildTrace(input: BuildSynthesisTraceInput): InteractionLlmTrace {
    const attemptedProviders = asUniqueProviders(input.attemptedProviders);

    if (!attemptedProviders.includes(input.selectedProvider)) {
      attemptedProviders.push(input.selectedProvider);
    }

    const trace: InteractionLlmTrace = {
      traceId: input.traceId,
      cacheHit: input.cacheHit,
      attemptedProviders,
      selectedProvider: input.selectedProvider,
      fallbackUsed: input.fallbackUsed,
      promptInteractionCount: input.promptItemCount,
      patientContextUsed: {
        age: input.contextSignals?.age ?? false,
        conditions: input.contextSignals?.conditions ?? false,
        renalFunction: input.contextSignals?.renalFunction ?? false,
      },
    };

    this.logger.info("Synthesis trace metadata", {
      component: this.componentName,
      trace,
    });

    return trace;
  }

  public snapshotTelemetry(): InteractionLlmTelemetry {
    const estimatedTotalTokens =
      this.estimatedPromptTokens + this.estimatedCompletionTokens;

    return {
      totalRequests: this.totalRequests,
      cacheHits: this.cacheHits,
      cacheHitRate:
        this.totalRequests > 0
          ? Number((this.cacheHits / this.totalRequests).toFixed(4))
          : 0,
      providerCalls: {
        groq: this.providerCalls.groq,
        gemini: this.providerCalls.gemini,
        ruleBased: this.providerCalls.ruleBased,
      },
      estimatedPromptTokens: this.estimatedPromptTokens,
      estimatedCompletionTokens: this.estimatedCompletionTokens,
      estimatedTotalTokens,
      estimatedSpendUsd: Number(this.estimatedSpendUsd.toFixed(6)),
    };
  }
}
