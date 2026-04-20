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
    patientContext: {
      age: 67,
      conditions: ["AFib", "CKD3"],
      renalFunction: "30-59 mL/min",
    },
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
        overallRisk: "high",
        contextualizedSummary: "Groq summary",
        recommendations: ["Groq recommendation"],
        interactionAnalyses: [
          {
            drug1: "warfarin",
            drug2: "ibuprofen",
            severity: "high",
            reasoning: "High bleeding risk in anticoagulated patients.",
            mechanism: "Additive anticoagulant and antiplatelet effects.",
            monitoringRecommendations: ["Monitor INR twice weekly."],
            saferAlternatives: ["Use acetaminophen if analgesia is required."],
          },
        ],
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
    expect(result.overallRisk).toBe("high");
    expect(result.summary).toContain("Groq");
    expect(result.trace.selectedProvider).toBe("groq");
    expect(result.trace.cacheHit).toBe(false);
    expect(result.telemetry.providerCalls.groq).toBe(1);
    expect(result.telemetry.totalRequests).toBe(1);
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
        overallRisk: "high",
        contextualizedSummary: "Gemini summary",
        recommendations: ["Gemini recommendation"],
        interactionAnalyses: [
          {
            drug1: "warfarin",
            drug2: "ibuprofen",
            severity: "high",
            reasoning: "Risk remains high with this combination.",
            mechanism: "Bleeding pathway overlap.",
            monitoringRecommendations: ["Track bleeding symptoms."],
            saferAlternatives: ["Switch NSAID to acetaminophen when feasible."],
          },
        ],
      }),
    };

    const service = new InteractionSynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("gemini");
    expect(result.overallRisk).toBe("high");
    expect(result.summary).toContain("Gemini");
    expect(result.trace.attemptedProviders).toEqual(["groq", "gemini"]);
    expect(result.trace.selectedProvider).toBe("gemini");
    expect(result.telemetry.providerCalls.groq).toBe(1);
    expect(result.telemetry.providerCalls.gemini).toBe(1);
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
    expect(result.interactionAnalyses.length).toBeGreaterThan(0);
    expect(result.trace.selectedProvider).toBe("rule-based");
    expect(result.trace.fallbackUsed).toBe(true);
  });

  it("falls back to rule-based when LLM output violates required schema", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        overallRisk: "high",
        contextualizedSummary: "Invalid because safer alternatives are missing.",
        recommendations: ["Monitor closely"],
        interactionAnalyses: [
          {
            drug1: "warfarin",
            drug2: "ibuprofen",
            severity: "high",
            reasoning: "High risk.",
            mechanism: "Mechanism",
            monitoringRecommendations: ["Monitor INR"],
            saferAlternatives: [],
          },
        ],
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

    expect(result.provider).toBe("rule-based");
    expect(result.interactionAnalyses[0]?.saferAlternatives.length).toBeGreaterThan(0);
    expect(result.trace.selectedProvider).toBe("rule-based");
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
    expect(result.trace.selectedProvider).toBe("rule-based");
    expect(result.trace.attemptedProviders).toEqual([
      "groq",
      "gemini",
      "rule-based",
    ]);
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
    expect(result.trace.selectedProvider).toBe("rule-based");
  });

  it("returns cached synthesis for repeated identical inputs", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        overallRisk: "high",
        contextualizedSummary: "Cached summary",
        recommendations: ["Cached recommendation"],
        interactionAnalyses: [
          {
            drug1: "warfarin",
            drug2: "ibuprofen",
            severity: "high",
            reasoning: "High bleeding risk.",
            mechanism: "Additive effects.",
            monitoringRecommendations: ["Monitor INR"],
            saferAlternatives: ["Acetaminophen"],
          },
        ],
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

    const first = await service.synthesize(input);
    const second = await service.synthesize(input);

    expect(first.summary).toBe(second.summary);
    expect(second.trace.cacheHit).toBe(true);
    expect(second.telemetry.cacheHits).toBeGreaterThan(0);
    expect(second.telemetry.cacheHitRate).toBeGreaterThan(0);
    expect(groqClient.generateStructuredJson).toHaveBeenCalledTimes(1);
  });

  it("rule-only synthesis returns no-interaction summary when interaction list is empty", async () => {
    const service = new RuleOnlyInteractionSynthesisService();
    const result = await service.synthesize({
      medications: ["metformin"],
      interactions: [],
      riskLevel: "low",
      patientContext: {
        conditions: [],
      },
    });

    expect(result.provider).toBe("rule-based");
    expect(result.summary.toLowerCase()).toContain("no interaction evidence");
    expect(result.overallRisk).toBe("low");
    expect(result.trace.selectedProvider).toBe("rule-based");
    expect(result.telemetry.providerCalls.ruleBased).toBe(1);
  });
});
