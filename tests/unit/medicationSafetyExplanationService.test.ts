import { Logger } from "../../src/logging/logger";
import { MedicationSafetyExplanationService } from "../../src/services/medicationSafetyExplanationService";

describe("MedicationSafetyExplanationService", () => {
  const logger = new Logger("error", { test: true });

  function createService() {
    return new MedicationSafetyExplanationService(logger, {
      synthesize: jest.fn().mockResolvedValue({
        headline: "Safety headline",
        explanation: "Explanation body",
        keyPoints: ["Point 1"],
        followUpQuestions: ["Question 1"],
        disclaimer: "Disclaimer text",
        provider: "rule-based",
      }),
    });
  }

  it("returns grade-8 reading level for patient audience", async () => {
    const service = createService();

    const result = await service.explainMedicationSafety(
      {
        audience: "patient",
        language: "en",
        medication: "ibuprofen",
        riskLevel: "high",
        findings: [
          {
            issue: "NSAID and anticoagulant combination",
            severity: "major",
            clinicalImpact: "Increased bleeding risk",
            recommendedAction: "Avoid combination",
          },
        ],
        recommendations: ["Use acetaminophen instead"],
      },
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.audience).toBe("patient");
    expect(result.readingLevel).toBe("grade-8");
    expect(result.analysisProvider).toBe("rule-based");
  });

  it("returns clinical reading level for provider audience", async () => {
    const service = createService();

    const result = await service.explainMedicationSafety(
      {
        audience: "provider",
        language: "en",
        medication: "metformin",
        riskLevel: "medium",
        findings: [],
        recommendations: [],
      },
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );

    expect(result.audience).toBe("provider");
    expect(result.readingLevel).toBe("clinical");
  });

  it("elevates risk to critical when contraindicated finding exists", async () => {
    const service = createService();

    const result = await service.explainMedicationSafety(
      {
        audience: "provider",
        language: "en",
        medication: "isotretinoin",
        riskLevel: "high",
        findings: [
          {
            issue: "Pregnancy exposure risk",
            severity: "contraindicated",
            clinicalImpact: "Fetal toxicity risk",
            recommendedAction: "Avoid medication",
          },
        ],
        recommendations: ["Switch to safer pregnancy-compatible therapy"],
      },
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );

    expect(result.riskLevel).toBe("critical");
  });

  it("rejects blank medication names", async () => {
    const service = createService();

    await expect(
      service.explainMedicationSafety(
        {
          audience: "patient",
          language: "en",
          medication: "   ",
          riskLevel: "low",
          findings: [],
          recommendations: [],
        },
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ),
    ).rejects.toThrow("Medication is required");
  });
});
