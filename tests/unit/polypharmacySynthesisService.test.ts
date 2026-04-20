import { Logger } from "../../src/logging/logger";
import {
  PolypharmacySynthesisService,
  RuleOnlyPolypharmacySynthesisService,
} from "../../src/services/polypharmacySynthesisService";

describe("PolypharmacySynthesisService", () => {
  const logger = new Logger("error", { test: true });

  const input = {
    patientAge: 78,
    patientConditions: ["heart failure"],
    currentMedications: ["diazepam", "diphenhydramine"],
    riskLevel: "high" as const,
    beersFlags: [
      {
        medication: "diphenhydramine",
        reason: "Anticholinergic burden",
        severity: "major" as const,
        evidence: "Beers criteria",
      },
    ],
    duplicateTherapeuticClasses: [
      {
        className: "Benzodiazepines",
        medications: ["diazepam", "lorazepam"],
        risk: "high" as const,
        rationale: "CNS depression overlap",
      },
    ],
    drugBurdenIndex: 1.6,
    deprescribingOpportunities: [
      {
        medication: "diazepam",
        rationale: "Fall risk",
        suggestedAction: "Taper over 4 weeks",
        priority: "high" as const,
      },
    ],
  };

  it("prefers Groq when available and valid", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        summary: "Groq polypharmacy summary",
        recommendations: ["Groq recommendation"],
      }),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn(),
    };

    const service = new PolypharmacySynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("groq");
    expect(result.summary).toContain("Groq");
    expect(geminiClient.generateStructuredJson).not.toHaveBeenCalled();
  });

  it("falls back to Gemini when Groq payload is invalid", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest
        .fn()
        .mockResolvedValue({ unsupported: true }),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateStructuredJson: jest.fn().mockResolvedValue({
        summary: "Gemini polypharmacy summary",
        recommendations: ["Gemini recommendation"],
      }),
    };

    const service = new PolypharmacySynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("gemini");
    expect(result.summary).toContain("Gemini");
  });

  it("uses rule-based summary when providers are unavailable", async () => {
    const groqClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const geminiClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      generateStructuredJson: jest.fn(),
    };

    const service = new PolypharmacySynthesisService(
      groqClient as never,
      geminiClient as never,
      logger,
    );

    const result = await service.synthesize(input);

    expect(result.provider).toBe("rule-based");
    expect(result.summary.toLowerCase()).toContain("identified");
  });

  it("rule-only service returns no-alert fallback when all flag groups are empty", async () => {
    const service = new RuleOnlyPolypharmacySynthesisService();
    const result = await service.synthesize({
      ...input,
      riskLevel: "low",
      beersFlags: [],
      duplicateTherapeuticClasses: [],
      deprescribingOpportunities: [],
    });

    expect(result.provider).toBe("rule-based");
    expect(result.summary.toLowerCase()).toContain(
      "no significant polypharmacy safety alerts",
    );
  });
});
