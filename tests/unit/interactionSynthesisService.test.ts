import { Logger } from "../../src/logging/logger";
import {
  InteractionSynthesisService,
  RuleOnlyInteractionSynthesisService,
} from "../../src/services/interactionSynthesisService";

describe("InteractionSynthesisService", () => {
  const logger = new Logger("error", { test: true });

  const input = {
    medications: ["warfarin", "ibuprofen"],
    riskLevel: "high" as const,
    interactions: [
      {
        drugs: ["warfarin", "ibuprofen"],
        severity: "major" as const,
        mechanism: "Bleeding risk increases due to combined effects.",
        clinicalImpact: "Potential major bleeding events.",
        recommendations: ["Avoid if possible."],
        evidence: "Test evidence",
      },
    ],
  };

  it("uses Groq when available and successful", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        summary: "Groq summary",
        recommendations: ["Groq recommendation"],
      }),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn(),
    };

    const service = new InteractionSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("groq");
    expect(result.summary).toContain("Groq");
    expect(geminiClient.generateStructuredJson).not.toHaveBeenCalled();
  });

  it("falls back to Gemini when Groq fails", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest
        .fn()
        .mockRejectedValue(new Error("Groq failed")),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        summary: "Gemini summary",
        recommendations: ["Gemini recommendation"],
      }),
    };

    const service = new InteractionSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("gemini");
    expect(result.summary).toContain("Gemini");
  });

  it("falls back to rule-based output when providers are unavailable", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const service = new InteractionSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("rule-based");
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("accepts non-array recommendations by coercing to an empty list", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        summary: "Groq summary",
        recommendations: "not-an-array",
      }),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const service = new InteractionSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("groq");
    expect(result.recommendations).toEqual([]);
  });

  it("falls back to rule-based output when both providers return invalid schemas", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({ invalid: true }),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({ invalid: true }),
    };

    const service = new InteractionSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("rule-based");
    expect(result.summary.toLowerCase()).toContain("detected");
  });

  it("falls back to rule-based output when Gemini throws", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest
        .fn()
        .mockRejectedValue(new Error("Gemini unavailable")),
    };

    const service = new InteractionSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("rule-based");
  });

  it("rule-only synthesis returns no-interaction summary when interaction list is empty", async () => {
    const service = new RuleOnlyInteractionSynthesisService();
    const result = await service.synthesize({
      medications: ["metformin"],
      interactions: [],
      riskLevel: "low",
    });

    expect(result.provider).toBe("rule-based");
    expect(result.summary.toLowerCase()).toContain("no interaction evidence");
  });
});
