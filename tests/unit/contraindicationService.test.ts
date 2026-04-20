import { Logger } from "../../src/logging/logger";
import { ContraindicationService } from "../../src/services/contraindicationService";

describe("ContraindicationService", () => {
  const logger = new Logger("error", { test: true });

  function createService(options?: {
    dailyMedResult?: {
      setId: string;
      title?: string;
      sections: {
        contraindications: string[];
        warnings: string[];
        pregnancy: string[];
        renal: string[];
        hepatic: string[];
      };
    } | null;
    dailyMedThrows?: boolean;
    synthesisThrows?: boolean;
  }) {
    const dailyMedClient = {
      getDrugLabelSections: options?.dailyMedThrows
        ? jest.fn().mockRejectedValue(new Error("dailymed failed"))
        : jest.fn().mockResolvedValue(options?.dailyMedResult ?? null),
    };

    const synthesisService = {
      synthesize: options?.synthesisThrows
        ? jest.fn().mockRejectedValue(new Error("synthesis failed"))
        : jest.fn().mockResolvedValue({
            summary: "Contraindication summary",
            recommendations: ["Recommendation 1"],
            provider: "rule-based",
          }),
    };

    return new ContraindicationService(
      logger,
      dailyMedClient as never,
      synthesisService,
    );
  }

  it("flags penicillin allergy with amoxicillin as contraindicated", async () => {
    const service = createService();

    const result = await service.checkContraindications(
      {
        proposedMedication: "amoxicillin",
        patientAllergies: ["Penicillin"],
        patientConditions: [],
      },
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.contraindicated).toBe(true);
    expect(result.riskLevel).toBe("critical");
    expect(
      result.contraindications.some((finding) => finding.trigger === "allergy"),
    ).toBe(true);
  });

  it("flags CKD with metformin as major risk", async () => {
    const service = createService();

    const result = await service.checkContraindications(
      {
        proposedMedication: "metformin",
        patientAllergies: [],
        patientConditions: ["Chronic Kidney Disease"],
      },
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );

    expect(
      result.contraindications.some((finding) => finding.severity === "major"),
    ).toBe(true);
    expect(["medium", "high"]).toContain(result.riskLevel);
  });

  it("flags metformin with eGFR under 30 as contraindicated", async () => {
    const service = createService();

    const result = await service.checkContraindications(
      {
        proposedMedication: "metformin",
        patientAllergies: [],
        patientConditions: [],
        labValues: {
          eGFR: 22,
        },
      },
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );

    expect(
      result.contraindications.some(
        (finding) => finding.severity === "contraindicated",
      ),
    ).toBe(true);
    expect(result.contraindicated).toBe(true);
  });

  it("flags pregnancy contraindication for isotretinoin", async () => {
    const service = createService();

    const result = await service.checkContraindications(
      {
        proposedMedication: "isotretinoin",
        patientAllergies: [],
        patientConditions: ["Pregnancy"],
      },
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );

    const pregnancyFinding = result.contraindications.find(
      (finding) => finding.trigger === "pregnancy",
    );
    expect(pregnancyFinding).toBeDefined();
    expect(pregnancyFinding?.severity).toBe("contraindicated");
  });

  it("adds DailyMed renal warning when eGFR is reduced", async () => {
    const service = createService({
      dailyMedResult: {
        setId: "SET-123",
        title: "Example label",
        sections: {
          contraindications: [],
          warnings: [],
          pregnancy: [],
          renal: ["Use caution in renal impairment and adjust dose."],
          hepatic: [],
        },
      },
    });

    const result = await service.checkContraindications(
      {
        proposedMedication: "metformin",
        patientAllergies: [],
        patientConditions: [],
        labValues: {
          egfr: 40,
        },
      },
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );

    expect(result.labelEvidence.setId).toBe("SET-123");
    expect(
      result.contraindications.some((finding) => finding.source === "dailymed"),
    ).toBe(true);
  });

  it("adds DailyMed pregnancy warning when pregnancy condition exists", async () => {
    const service = createService({
      dailyMedResult: {
        setId: "SET-456",
        sections: {
          contraindications: [],
          warnings: [],
          pregnancy: ["Contraindicated in pregnancy due to fetal toxicity."],
          renal: [],
          hepatic: [],
        },
      },
    });

    const result = await service.checkContraindications(
      {
        proposedMedication: "example-medication",
        patientAllergies: [],
        patientConditions: ["pregnant"],
      },
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    );

    expect(
      result.contraindications.some((finding) => finding.source === "dailymed"),
    ).toBe(true);
  });

  it("continues with rules when DailyMed lookup fails", async () => {
    const service = createService({ dailyMedThrows: true });

    const result = await service.checkContraindications(
      {
        proposedMedication: "metformin",
        patientAllergies: [],
        patientConditions: ["CKD"],
      },
      "11111111-1111-4111-8111-111111111111",
    );

    expect(result.source).toBe("rules-dailymed");
    expect(result.contraindications.length).toBeGreaterThan(0);
  });

  it("returns low risk when no contraindications are found", async () => {
    const service = createService();

    const result = await service.checkContraindications(
      {
        proposedMedication: "loratadine",
        patientAllergies: [],
        patientConditions: [],
      },
      "22222222-2222-4222-8222-222222222222",
    );

    expect(result.riskLevel).toBe("low");
    expect(result.contraindications).toHaveLength(0);
    expect(result.contraindicated).toBe(false);
  });

  it("throws validation error when proposed medication is empty", async () => {
    const service = createService();

    await expect(
      service.checkContraindications(
        {
          proposedMedication: "   ",
          patientAllergies: [],
          patientConditions: [],
        },
        "32222222-2222-4222-8222-222222222222",
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("adds hyperkalemia lab warning for potassium-raising medications", async () => {
    const service = createService();

    const result = await service.checkContraindications(
      {
        proposedMedication: "spironolactone",
        patientAllergies: [],
        patientConditions: [],
        labValues: {
          potassium: "5.8 mmol/L",
        },
      },
      "42222222-2222-4222-8222-222222222222",
    );

    expect(
      result.contraindications.some((finding) =>
        finding.evidence.toLowerCase().includes("hyperkalemia"),
      ),
    ).toBe(true);
  });

  it("adds hepatotoxic lab warning when transaminases are elevated", async () => {
    const service = createService();

    const result = await service.checkContraindications(
      {
        proposedMedication: "valproate",
        patientAllergies: [],
        patientConditions: [],
        labValues: {
          ALT: "132 U/L",
          AST: 140,
        },
      },
      "52222222-2222-4222-8222-222222222222",
    );

    expect(
      result.contraindications.some((finding) =>
        finding.rationale.toLowerCase().includes("transaminases"),
      ),
    ).toBe(true);
  });

  it("adds DailyMed hepatic finding when liver disease context is present", async () => {
    const service = createService({
      dailyMedResult: {
        setId: "SET-HEPATIC",
        sections: {
          contraindications: [],
          warnings: [],
          pregnancy: [],
          renal: [],
          hepatic: ["Use caution in hepatic impairment."],
        },
      },
    });

    const result = await service.checkContraindications(
      {
        proposedMedication: "methotrexate",
        patientAllergies: [],
        patientConditions: ["cirrhosis"],
      },
      "62222222-2222-4222-8222-222222222222",
    );

    expect(
      result.contraindications.some(
        (finding) =>
          finding.source === "dailymed" && finding.trigger === "label-warning",
      ),
    ).toBe(true);
  });

  it("adds DailyMed hypersensitivity warning for prior anaphylaxis history", async () => {
    const service = createService({
      dailyMedResult: {
        setId: "SET-WARN",
        sections: {
          contraindications: [],
          warnings: ["Serious hypersensitivity reactions have occurred."],
          pregnancy: [],
          renal: [],
          hepatic: [],
        },
      },
    });

    const result = await service.checkContraindications(
      {
        proposedMedication: "example-medication",
        patientAllergies: [],
        patientConditions: ["anaphylaxis"],
      },
      "72222222-2222-4222-8222-222222222222",
    );

    expect(
      result.contraindications.some(
        (finding) =>
          finding.source === "dailymed" &&
          finding.rationale.toLowerCase().includes("hypersensitivity"),
      ),
    ).toBe(true);
  });

  it("deduplicates repeated findings from duplicate allergy and condition entries", async () => {
    const service = createService();

    const result = await service.checkContraindications(
      {
        proposedMedication: "amoxicillin",
        patientAllergies: ["penicillin", "Penicillin"],
        patientConditions: ["pregnancy", "Pregnancy"],
      },
      "82222222-2222-4222-8222-222222222222",
    );

    const penicillinFindings = result.contraindications.filter((finding) =>
      finding.evidence.toLowerCase().includes("penicillin-class"),
    );
    expect(penicillinFindings).toHaveLength(1);
  });

  it("falls back to rule-only synthesis when synthesis engine throws", async () => {
    const service = createService({ synthesisThrows: true });

    const result = await service.checkContraindications(
      {
        proposedMedication: "metformin",
        patientAllergies: [],
        patientConditions: ["CKD"],
      },
      "92222222-2222-4222-8222-222222222222",
    );

    expect(result.analysisProvider).toBe("rule-based");
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
