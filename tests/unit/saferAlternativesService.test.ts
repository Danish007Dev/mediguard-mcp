import { Logger } from "../../src/logging/logger";
import { SaferAlternativesService } from "../../src/services/saferAlternativesService";

describe("SaferAlternativesService", () => {
  const logger = new Logger("error", { test: true });

  function createService(options?: { synthesisThrows?: boolean }) {
    return new SaferAlternativesService(logger, {
      synthesize: options?.synthesisThrows
        ? jest.fn().mockRejectedValue(new Error("synthesis failed"))
        : jest.fn().mockResolvedValue({
            summary: "Safer alternatives summary",
            recommendations: ["Recommendation 1"],
            provider: "rule-based",
          }),
    });
  }

  it("throws validation error when proposed medication is empty", async () => {
    const service = createService();

    await expect(
      service.getSaferAlternatives(
        {
          proposedMedication: "   ",
          currentMedications: [],
          patientAllergies: [],
          patientConditions: [],
          formularyPreferred: [],
          maxAlternatives: 5,
        },
        "0aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("suggests acetaminophen as top option for warfarin plus ibuprofen scenario", async () => {
    const service = createService();

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "ibuprofen",
        currentMedications: ["warfarin"],
        patientAllergies: [],
        patientConditions: [],
        formularyPreferred: [],
        maxAlternatives: 5,
      },
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.riskLevel).toBe("high");
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.alternatives[0]?.medication.toLowerCase()).toContain(
      "acetaminophen",
    );
    expect(
      result.riskContext.some((item) =>
        item.toLowerCase().includes("bleeding"),
      ),
    ).toBe(true);
  });

  it("removes alternatives that conflict with recorded allergies", async () => {
    const service = createService();

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "ibuprofen",
        currentMedications: [],
        patientAllergies: ["acetaminophen"],
        patientConditions: [],
        formularyPreferred: [],
        maxAlternatives: 5,
      },
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );

    expect(
      result.alternatives.some((option) =>
        option.medication.toLowerCase().includes("acetaminophen"),
      ),
    ).toBe(false);
  });

  it("prioritizes formulary-preferred options when safety is comparable", async () => {
    const service = createService();

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "glyburide",
        currentMedications: [],
        patientAllergies: [],
        patientConditions: [],
        formularyPreferred: ["sitagliptin"],
        maxAlternatives: 5,
      },
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );

    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.alternatives[0]?.medication.toLowerCase()).toContain(
      "sitagliptin",
    );
    expect(result.alternatives[0]?.formularyPreferred).toBe(true);
  });

  it("raises risk context for NSAID use in CKD and heart failure", async () => {
    const service = createService();

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "naproxen",
        currentMedications: [],
        patientAllergies: [],
        patientConditions: ["CKD", "Heart Failure"],
        formularyPreferred: [],
        maxAlternatives: 5,
      },
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );

    expect(result.riskLevel).toBe("high");
    expect(
      result.riskContext.some((item) => item.toLowerCase().includes("kidney")),
    ).toBe(true);
    expect(
      result.riskContext.some((item) =>
        item.toLowerCase().includes("heart failure"),
      ),
    ).toBe(true);
  });

  it("raises sedation-related risk context for sedative use in patients at fall risk", async () => {
    const service = createService();

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "diazepam",
        currentMedications: [],
        patientAllergies: [],
        patientConditions: ["fall risk", "cognitive impairment"],
        formularyPreferred: [],
        maxAlternatives: 5,
      },
      "abaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.riskLevel).toBe("high");
    expect(
      result.riskContext.some((item) =>
        item.toLowerCase().includes("fall risk"),
      ),
    ).toBe(true);
  });

  it("sets critical risk for teratogenic medication in pregnancy", async () => {
    const service = createService();

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "valproate",
        currentMedications: [],
        patientAllergies: [],
        patientConditions: ["pregnant"],
        formularyPreferred: [],
        maxAlternatives: 5,
      },
      "acaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.riskLevel).toBe("critical");
    expect(
      result.riskContext.some((item) =>
        item.toLowerCase().includes("fetal toxicity"),
      ),
    ).toBe(true);
  });

  it("clamps top candidate safety score to 100 for high-match scenarios", async () => {
    const service = createService();

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "ibuprofen",
        currentMedications: ["warfarin"],
        patientAllergies: [],
        patientConditions: ["ckd", "heart failure"],
        formularyPreferred: ["acetaminophen"],
        maxAlternatives: 5,
      },
      "adaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.alternatives[0]?.safetyScore).toBe(100);
  });

  it("keeps at least one option when maxAlternatives is set to zero", async () => {
    const service = createService();

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "unknown-rare-medication",
        currentMedications: [],
        patientAllergies: [],
        patientConditions: [],
        formularyPreferred: [],
        maxAlternatives: 0,
      },
      "aeaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.alternatives.length).toBe(1);
  });

  it("falls back to rule-only synthesis when synthesis provider throws", async () => {
    const service = createService({ synthesisThrows: true });

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "ibuprofen",
        currentMedications: [],
        patientAllergies: [],
        patientConditions: [],
        formularyPreferred: [],
        maxAlternatives: 5,
      },
      "afaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.analysisProvider).toBe("rule-based");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("returns fallback alternative when no therapeutic mapping exists", async () => {
    const service = createService();

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "unknown-rare-medication",
        currentMedications: [],
        patientAllergies: [],
        patientConditions: [],
        formularyPreferred: [],
        maxAlternatives: 3,
      },
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );

    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.alternatives[0]?.medication.toLowerCase()).toContain(
      "specialist review",
    );
  });

  it("ignores blank entries in contextual arrays", async () => {
    const service = createService();

    const result = await service.getSaferAlternatives(
      {
        proposedMedication: "ibuprofen",
        currentMedications: ["   ", "warfarin", ""],
        patientAllergies: [" ", "none"],
        patientConditions: ["   ", "CKD"],
        formularyPreferred: [" ", "acetaminophen"],
        maxAlternatives: 5,
      },
      "f0eeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );

    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(
      result.riskContext.some((item) => item.toLowerCase().includes("kidney")),
    ).toBe(true);
  });
});
