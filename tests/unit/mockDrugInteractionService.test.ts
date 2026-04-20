import { MockDrugInteractionService } from "../../src/services/mockDrugInteractionService";

describe("MockDrugInteractionService", () => {
  const service = new MockDrugInteractionService();

  it("returns high or critical risk when a known severe interaction is present", async () => {
    const result = await service.checkDrugInteractions(
      ["warfarin", "ibuprofen", "vitamin d"],
      "11111111-1111-4111-8111-111111111111",
    );

    expect(result.interactions.length).toBeGreaterThan(0);
    expect(["high", "critical"]).toContain(result.riskLevel);
  });

  it("returns low risk when no known mock interactions are present", async () => {
    const result = await service.checkDrugInteractions(
      ["metformin", "levothyroxine"],
      "22222222-2222-4222-8222-222222222222",
    );

    expect(result.interactions).toHaveLength(0);
    expect(result.riskLevel).toBe("low");
  });
});
