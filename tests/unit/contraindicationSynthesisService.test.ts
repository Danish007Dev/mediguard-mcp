import { Logger } from "../../src/logging/logger";
import {
  ContraindicationSynthesisService,
  RuleOnlyContraindicationSynthesisService,
} from "../../src/services/contraindicationSynthesisService";

describe("ContraindicationSynthesisService", () => {
  const logger = new Logger("error", { test: true });

  const input = {
    proposedMedication: "metformin",
    patientAllergies: ["penicillin"],
    patientConditions: ["ckd"],
    normalizedLabs: { egfr: 25 },
    riskLevel: "high" as const,
    contraindications: [
      {
        medication: "metformin",
        trigger: "lab" as const,
        severity: "major" as const,
        rationale: "Low eGFR raises lactic acidosis risk.",
        recommendation: "Avoid initiation.",
        evidence: "Lab threshold rule",
        source: "rules" as const,
      },
    ],
  };

  it("uses Groq when configured and response schema is valid", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        summary: "Groq contraindication summary",
        recommendations: ["Groq recommendation"],
      }),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn(),
    };

    const service = new ContraindicationSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("groq");
    expect(result.summary).toContain("Groq");
    expect(result.trace?.selectedProvider).toBe("groq");
    expect(result.telemetry?.providerCalls.groq).toBeGreaterThan(0);
    expect(geminiClient.generateStructuredJson).not.toHaveBeenCalled();
  });

  it("falls back to Gemini when Groq response schema is invalid", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({ invalid: true }),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        summary: "Gemini contraindication summary",
        recommendations: ["Gemini recommendation"],
      }),
    };

    const service = new ContraindicationSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("gemini");
    expect(result.summary).toContain("Gemini");
    expect(result.trace?.fallbackUsed).toBe(true);
  });

  it("falls back to rule-based summary when providers are unavailable", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const service = new ContraindicationSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("rule-based");
    expect(result.summary).toContain("1 finding");
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.trace?.selectedProvider).toBe("rule-based");
  });

  it("rule-only service returns no-finding fallback when contraindications are absent", async () => {
    const service = new RuleOnlyContraindicationSynthesisService();
    const result = await service.synthesize({
      ...input,
      riskLevel: "low",
      contraindications: [],
    });

    expect(result.provider).toBe("rule-based");
    expect(result.summary.toLowerCase()).toContain("no contraindications");
  });
});
