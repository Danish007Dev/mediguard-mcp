import { Logger } from "../../src/logging/logger";
import { executeSimulateWhatIfMedicationChange } from "../../src/tools/simulateWhatIfMedicationChange";

function buildWhatIfResult() {
  return {
    requestId: "11111111-1111-4111-8111-111111111111",
    source: "rules-what-if" as const,
    analysisProvider: "rule-based" as const,
    recommendation: "safer" as const,
    proposedChange: {
      action: "replace" as const,
      drug: "ibuprofen",
      replacementDrug: "acetaminophen",
    },
    current: {
      medications: ["warfarin", "ibuprofen"],
      score: 75,
      grade: "B" as const,
      riskLevel: "medium" as const,
      interactionCount: 1,
    },
    proposed: {
      medications: ["warfarin", "acetaminophen"],
      score: 90,
      grade: "A" as const,
      riskLevel: "low" as const,
      interactionCount: 0,
    },
    delta: {
      scoreDelta: 15,
      interactionDelta: -1,
      gradeChanged: true,
      riskLevelChanged: true,
    },
    newRisks: [],
    resolvedRisks: [
      {
        drugs: ["warfarin", "ibuprofen"],
        severity: "major" as const,
        mechanism: "Bleeding",
        clinicalImpact: "Major bleed risk",
        recommendations: ["Avoid overlap"],
        evidence: "label",
      },
    ],
    explanation: "test explanation",
    generatedAt: new Date().toISOString(),
  };
}

describe("simulate_medication_change tool", () => {
  const logger = new Logger("error", { test: true });

  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns structured simulation output for valid input", async () => {
    const service = {
      simulate: jest.fn().mockResolvedValue(buildWhatIfResult()),
    };

    const result = await executeSimulateWhatIfMedicationChange(
      {
        patient_age: 70,
        patient_conditions: ["atrial fibrillation"],
        current_medications: ["warfarin", "ibuprofen"],
        proposed_change: {
          action: "replace",
          drug: "ibuprofen",
          replacement_drug: "acetaminophen",
        },
      },
      {
        service,
        logger,
      },
    );

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as {
      recommendation: string;
      delta: { scoreDelta: number };
    };

    expect(structured.recommendation).toBe("safer");
    expect(structured.delta.scoreDelta).toBe(15);
  });

  it("returns validation error when replace action has no replacement_drug", async () => {
    const service = {
      simulate: jest.fn(),
    };

    const result = await executeSimulateWhatIfMedicationChange(
      {
        patient_age: 70,
        patient_conditions: [],
        current_medications: ["warfarin", "ibuprofen"],
        proposed_change: {
          action: "replace",
          drug: "ibuprofen",
        },
      },
      {
        service,
        logger,
      },
    );

    expect(result.isError).toBe(true);
    expect(service.simulate).not.toHaveBeenCalled();
  });

  it("hydrates medications and conditions from sharp_context", async () => {
    const service = {
      simulate: jest.fn().mockResolvedValue(buildWhatIfResult()),
    };

    const sharpContextService = {
      resolveMedications: jest
        .fn()
        .mockResolvedValue(["warfarin", "ibuprofen"]),
      resolveConditions: jest.fn().mockResolvedValue(["atrial fibrillation"]),
      propagateContext: jest.fn(),
      resolveAllergies: jest.fn(),
    };

    const result = await executeSimulateWhatIfMedicationChange(
      {
        current_medications: [],
        patient_conditions: [],
        proposed_change: {
          action: "remove",
          drug: "ibuprofen",
        },
        sharp_context: {
          patient_id: "patient-123",
          fhir_endpoint: "https://fhir.example.com",
          auth_token: "token",
        },
      },
      {
        service,
        logger,
        sharpContextService,
      },
    );

    expect(result.isError).not.toBe(true);
    expect(sharpContextService.resolveMedications).toHaveBeenCalledTimes(1);
    expect(sharpContextService.resolveConditions).toHaveBeenCalledTimes(1);
    expect(sharpContextService.propagateContext).toHaveBeenCalledTimes(1);
    expect(service.simulate).toHaveBeenCalledTimes(1);
  });
});
