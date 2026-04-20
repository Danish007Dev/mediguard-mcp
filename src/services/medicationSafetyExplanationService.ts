import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type {
  ExplainMedicationSafetyResult,
  MedicationSafetyExplanationFinding,
} from "../types/medicationSafety";
import {
  RuleOnlyMedicationSafetyExplanationSynthesisService,
  type MedicationSafetyExplanationSynthesisInput,
  type MedicationSafetyExplanationSynthesisResult,
} from "./medicationSafetyExplanationSynthesisService";

export interface ExplainMedicationSafetyInput {
  audience: "patient" | "provider";
  language: string;
  medication: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  findings: MedicationSafetyExplanationFinding[];
  recommendations: string[];
}

type MedicationSafetyExplanationSynthesisEngine = {
  synthesize(
    input: MedicationSafetyExplanationSynthesisInput,
  ): Promise<MedicationSafetyExplanationSynthesisResult>;
};

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function toSlug(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function asUnique(values: string[]): string[] {
  const unique = new Map<string, string>();

  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, cleaned);
    }
  }

  return Array.from(unique.values());
}

function inferRiskLevel(
  inputRisk: "low" | "medium" | "high" | "critical",
  findings: MedicationSafetyExplanationFinding[],
): "low" | "medium" | "high" | "critical" {
  const hasContraindicated = findings.some(
    (finding) => finding.severity === "contraindicated",
  );
  const majorCount = findings.filter(
    (finding) => finding.severity === "major",
  ).length;
  const moderateCount = findings.filter(
    (finding) => finding.severity === "moderate",
  ).length;

  if (hasContraindicated) {
    return "critical";
  }

  if (majorCount >= 2) {
    return "high";
  }

  if (majorCount >= 1 || moderateCount >= 2) {
    return inputRisk === "critical"
      ? "high"
      : inputRisk === "low"
        ? "medium"
        : inputRisk;
  }

  return inputRisk;
}

/**
 * Builds patient/provider explanations from structured safety findings.
 */
export class MedicationSafetyExplanationService {
  public constructor(
    private readonly logger: Logger,
    private readonly synthesisService: MedicationSafetyExplanationSynthesisEngine = new RuleOnlyMedicationSafetyExplanationSynthesisService(),
  ) {}

  public async explainMedicationSafety(
    input: ExplainMedicationSafetyInput,
    requestId: string,
  ): Promise<ExplainMedicationSafetyResult> {
    const medication = normalizeWhitespace(input.medication);
    if (!medication) {
      throw new AppError(
        "Medication is required for explanation generation.",
        "VALIDATION_ERROR",
      );
    }

    const language = toSlug(input.language || "en");
    const audience = input.audience;

    const findings = input.findings
      .map((finding) => ({
        issue: normalizeWhitespace(finding.issue),
        severity: finding.severity,
        clinicalImpact: normalizeWhitespace(finding.clinicalImpact),
        recommendedAction: normalizeWhitespace(finding.recommendedAction),
      }))
      .filter(
        (finding) =>
          finding.issue.length > 0 && finding.clinicalImpact.length > 0,
      )
      .slice(0, 12);

    const recommendations = asUnique(input.recommendations).slice(0, 10);
    const riskLevel = inferRiskLevel(input.riskLevel, findings);

    const synthesis = await this.safeSynthesize({
      audience,
      language,
      medication,
      riskLevel,
      findings,
      recommendations,
    });

    return {
      requestId,
      source: "template-llm",
      analysisProvider: synthesis.provider,
      audience,
      language,
      readingLevel: audience === "patient" ? "grade-8" : "clinical",
      medication,
      riskLevel,
      headline: synthesis.headline,
      explanation: synthesis.explanation,
      keyPoints: synthesis.keyPoints,
      followUpQuestions: synthesis.followUpQuestions,
      disclaimer: synthesis.disclaimer,
      llmTrace: synthesis.trace,
      llmTelemetry: synthesis.telemetry,
      generatedAt: new Date().toISOString(),
    };
  }

  private async safeSynthesize(
    input: MedicationSafetyExplanationSynthesisInput,
  ): Promise<MedicationSafetyExplanationSynthesisResult> {
    try {
      return await this.synthesisService.synthesize(input);
    } catch (error) {
      this.logger.warn(
        "Medication explanation synthesis failed; using rule-only summary fallback.",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );

      return new RuleOnlyMedicationSafetyExplanationSynthesisService().synthesize(
        input,
      );
    }
  }
}
