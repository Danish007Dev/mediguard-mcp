import { Logger } from "../../src/logging/logger";
import { PolypharmacyService } from "../../src/services/polypharmacyService";

describe("PolypharmacyService", () => {
  const logger = new Logger("error", { test: true });

  function createService() {
    return new PolypharmacyService(logger, {
      synthesize: jest.fn().mockResolvedValue({
        summary: "Synthesis summary",
        recommendations: ["Synthesis recommendation"],
        provider: "rule-based",
      }),
    });
  }

  it("flags Beers criteria medications in elderly patients", async () => {
    const service = createService();

    const result = await service.analyzePolypharmacy(
      {
        patientAge: 78,
        patientConditions: [],
        currentMedications: ["diphenhydramine"],
      },
      "11111111-1111-4111-8111-111111111111",
    );

    expect(result.beersFlags.length).toBeGreaterThan(0);
    expect(result.beersFlags[0].medication.toLowerCase()).toContain(
      "diphenhydramine",
    );
  });

  it("does not apply Beers flags for non-elderly patients", async () => {
    const service = createService();

    const result = await service.analyzePolypharmacy(
      {
        patientAge: 40,
        patientConditions: [],
        currentMedications: ["diphenhydramine"],
      },
      "22222222-2222-4222-8222-222222222222",
    );

    expect(result.beersFlags).toHaveLength(0);
  });

  it("detects duplicate therapeutic classes", async () => {
    const service = createService();

    const result = await service.analyzePolypharmacy(
      {
        patientAge: 55,
        patientConditions: [],
        currentMedications: ["ibuprofen", "naproxen"],
      },
      "33333333-3333-4333-8333-333333333333",
    );

    const nsaidFlag = result.duplicateTherapeuticClasses.find((flag) =>
      flag.className.toLowerCase().includes("nsaid"),
    );

    expect(nsaidFlag).toBeDefined();
    expect(nsaidFlag?.medications.length).toBeGreaterThanOrEqual(2);
  });

  it("calculates elevated drug burden index for sedative and anticholinergic drugs", async () => {
    const service = createService();

    const result = await service.analyzePolypharmacy(
      {
        patientAge: 70,
        patientConditions: [],
        currentMedications: ["diazepam", "diphenhydramine"],
      },
      "44444444-4444-4444-8444-444444444444",
    );

    expect(result.drugBurdenIndex).toBeGreaterThanOrEqual(1.0);
  });

  it("adds condition-specific warning for heart failure plus NSAID exposure", async () => {
    const service = createService();

    const result = await service.analyzePolypharmacy(
      {
        patientAge: 66,
        patientConditions: ["Heart Failure"],
        currentMedications: ["ibuprofen", "metformin"],
      },
      "55555555-5555-4555-8555-555555555555",
    );

    const conditionFlag = result.duplicateTherapeuticClasses.find((flag) =>
      flag.className.toLowerCase().includes("heart failure"),
    );

    expect(conditionFlag).toBeDefined();
    expect(conditionFlag?.risk).toBe("high");
  });

  it("produces deprescribing opportunities when significant flags are present", async () => {
    const service = createService();

    const result = await service.analyzePolypharmacy(
      {
        patientAge: 73,
        patientConditions: ["Falls"],
        currentMedications: ["diazepam", "clonazepam", "diphenhydramine"],
      },
      "66666666-6666-4666-8666-666666666666",
    );

    expect(result.deprescribingOpportunities.length).toBeGreaterThan(0);
    expect(["high", "critical"]).toContain(result.riskLevel);
  });
});
