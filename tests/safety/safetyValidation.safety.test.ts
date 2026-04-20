import { MockDrugInteractionService } from "../../src/services/mockDrugInteractionService";

describe("Phase 4 safety validation", () => {
  const service = new MockDrugInteractionService();

  it("flags known dangerous interactions", async () => {
    const result = await service.checkDrugInteractions(
      ["warfarin", "ibuprofen"],
      "11111111-1111-4111-8111-111111111111",
    );

    expect(result.interactions.length).toBeGreaterThan(0);
    expect(["major", "contraindicated"]).toContain(
      result.interactions[0]?.severity,
    );
    expect(["high", "critical"]).toContain(result.riskLevel);
  });

  it("keeps mock false positive rate under 5% on low-risk cohorts", async () => {
    const lowRiskCohorts = [
      ["metformin", "levothyroxine"],
      ["amlodipine", "lisinopril"],
      ["sertraline", "omeprazole"],
      ["atorvastatin", "vitamin d"],
      ["losartan", "hydrochlorothiazide"],
      ["albuterol", "fluticasone"],
      ["gabapentin", "acetaminophen"],
      ["pantoprazole", "ondansetron"],
      ["furosemide", "potassium chloride"],
      ["insulin glargine", "metformin"],
    ];

    let falsePositiveCount = 0;
    for (let index = 0; index < lowRiskCohorts.length; index += 1) {
      const result = await service.checkDrugInteractions(
        lowRiskCohorts[index] ?? [],
        `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
      );

      if (result.interactions.length > 0) {
        falsePositiveCount += 1;
      }
    }

    const falsePositiveRate = falsePositiveCount / lowRiskCohorts.length;
    expect(falsePositiveRate).toBeLessThan(0.05);
  });

  it("handles uncertainty safely when no interaction evidence is present", async () => {
    const result = await service.checkDrugInteractions(
      ["custom-compound-a", "custom-compound-b"],
      "33333333-3333-4333-8333-333333333333",
    );

    expect(result.interactions).toHaveLength(0);
    expect(result.riskLevel).toBe("low");
    expect(result.summary.toLowerCase()).toContain(
      "no mock interaction matches",
    );
    expect(result.analysisRecommendations[0]?.toLowerCase()).toContain(
      "monitoring",
    );
  });
});
