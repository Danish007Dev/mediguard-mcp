import { Logger } from "../../src/logging/logger";
import {
  MedicationSafetyExplanationSynthesisService,
  RuleOnlyMedicationSafetyExplanationSynthesisService,
} from "../../src/services/medicationSafetyExplanationSynthesisService";

describe("MedicationSafetyExplanationSynthesisService", () => {
  const logger = new Logger("error", { test: true });

  const input = {
    audience: "patient" as const,
    language: "en",
    medication: "warfarin",
    riskLevel: "high" as const,
    findings: [
      {
        issue: "Drug interaction",
        severity: "major" as const,
        clinicalImpact: "Potential hemorrhage and gastrointestinal injury.",
        recommendedAction: "Avoid this combination.",
      },
    ],
    recommendations: ["Monitor INR closely and avoid NSAID overlap."],
  };

  it("uses Groq when configured and valid", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        headline: "Groq headline",
        explanation: "Groq explanation",
        keyPoints: ["Point A"],
        followUpQuestions: ["Question A"],
        disclaimer: "Groq disclaimer",
      }),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn(),
    };

    const service = new MedicationSafetyExplanationSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("groq");
    expect(result.headline).toContain("Groq");
    expect(geminiClient.generateStructuredJson).not.toHaveBeenCalled();
  });

  it("falls back to Gemini when Groq fails", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest
        .fn()
        .mockRejectedValue(new Error("Groq down")),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        headline: "Gemini headline",
        explanation: "Gemini explanation",
        keyPoints: ["Point B"],
        followUpQuestions: ["Question B"],
        disclaimer: "Gemini disclaimer",
      }),
    };

    const service = new MedicationSafetyExplanationSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("gemini");
    expect(result.headline).toContain("Gemini");
  });

  it("uses readable rule-based patient fallback when providers are unavailable", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const service = new MedicationSafetyExplanationSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("rule-based");
    expect(result.headline).toContain("warfarin");
    expect(result.explanation.toLowerCase()).toContain("serious bleeding");
  });

  it("rule-only service supports provider audience output", async () => {
    const service = new RuleOnlyMedicationSafetyExplanationSynthesisService();
    const result = await service.synthesize({
      ...input,
      audience: "provider",
      riskLevel: "critical",
    });

    expect(result.provider).toBe("rule-based");
    expect(result.headline.toLowerCase()).toContain(
      "clinical safety rationale",
    );
  });
});
