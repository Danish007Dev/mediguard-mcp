import { Logger } from "../../src/logging/logger";
import {
  SaferAlternativesSynthesisService,
  RuleOnlySaferAlternativesSynthesisService,
} from "../../src/services/saferAlternativesSynthesisService";

describe("SaferAlternativesSynthesisService", () => {
  const logger = new Logger("error", { test: true });

  const input = {
    proposedMedication: "ibuprofen",
    riskLevel: "high" as const,
    riskContext: ["bleeding risk with anticoagulants"],
    alternatives: [
      {
        medication: "acetaminophen",
        therapeuticClass: "Analgesic",
        safetyScore: 92,
        formularyPreferred: true,
        avoidsRisks: ["nsaid-related bleeding"],
        cautionFlags: [],
        rationale: "Lower bleeding risk than non-selective NSAIDs.",
      },
    ],
  };

  it("uses Groq when configured and valid", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        summary: "Groq alternatives summary",
        recommendations: ["Groq recommendation"],
      }),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn(),
    };

    const service = new SaferAlternativesSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("groq");
    expect(result.summary).toContain("Groq");
    expect(geminiClient.generateStructuredJson).not.toHaveBeenCalled();
  });

  it("falls back to Gemini when Groq throws", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest
        .fn()
        .mockRejectedValue(new Error("Groq unavailable")),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        summary: "Gemini alternatives summary",
        recommendations: ["Gemini recommendation"],
      }),
    };

    const service = new SaferAlternativesSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("gemini");
    expect(result.summary).toContain("Gemini");
  });

  it("uses rule-based fallback when providers are unavailable", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const service = new SaferAlternativesSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("rule-based");
    expect(result.summary).toContain("Top-ranked option");
  });

  it("rule-only service returns no-option fallback when alternatives are empty", async () => {
    const service = new RuleOnlySaferAlternativesSynthesisService();
    const result = await service.synthesize({
      ...input,
      alternatives: [],
    });

    expect(result.provider).toBe("rule-based");
    expect(result.summary.toLowerCase()).toContain(
      "no strong safer alternatives",
    );
  });
});
