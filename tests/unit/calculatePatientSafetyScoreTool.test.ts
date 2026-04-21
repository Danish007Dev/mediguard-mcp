import { Logger } from "../../src/logging/logger";
import { executeCalculatePatientSafetyScore } from "../../src/tools/calculatePatientSafetyScore";

describe("calculate_patient_safety_score tool", () => {
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

  it("returns structured score result for valid input", async () => {
    const service = {
      calculateSafetyScore: jest.fn().mockResolvedValue({
        requestId: "44444444-4444-4444-8444-444444444444",
        source: "rules-interactions",
        analysisProvider: "rule-based",
        riskLevel: "medium",
        score: 82,
        grade: "B",
        medicationCount: 5,
        deductionTotal: 18,
        deductions: [
          {
            category: "Drug interactions",
            points: 15,
            rationale: "Major interaction detected.",
          },
        ],
        interactionSummary: {
          contraindicated: 0,
          major: 1,
          moderate: 0,
          minor: 0,
        },
        beersFlags: [],
        duplicateTherapeuticClasses: [],
        improvementOpportunities: [
          {
            title: "Mitigate high-severity interactions",
            action: "Switch NSAID to safer alternative.",
            expectedPointsGain: 15,
          },
        ],
        potentialOptimizedScore: 97,
        summary: "Patient safety score summary",
        generatedAt: new Date().toISOString(),
      }),
    };

    const response = await executeCalculatePatientSafetyScore(
      {
        patient_age: 70,
        patient_conditions: ["hypertension"],
        current_medications: ["warfarin", "ibuprofen"],
      },
      {
        service,
        logger,
      },
    );

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toBeDefined();

    const structured = response.structuredContent as {
      dashboardArtifact?: {
        scoreCard: {
          score: number;
          potentialOptimizedScore: number;
          optimizationGap: number;
        };
        severityChart: Array<{ severity: string; count: number }>;
      };
    };

    expect(structured.dashboardArtifact).toBeDefined();
    expect(structured.dashboardArtifact?.scoreCard.score).toBe(82);
    expect(structured.dashboardArtifact?.scoreCard.potentialOptimizedScore).toBe(97);
    expect(structured.dashboardArtifact?.scoreCard.optimizationGap).toBe(15);
    expect(structured.dashboardArtifact?.severityChart).toEqual([
      { severity: "contraindicated", count: 0 },
      { severity: "major", count: 1 },
      { severity: "moderate", count: 0 },
      { severity: "minor", count: 0 },
    ]);
  });

  it("returns error response when score service throws", async () => {
    const service = {
      calculateSafetyScore: jest
        .fn()
        .mockRejectedValue(new Error("score failure")),
    };

    const response = await executeCalculatePatientSafetyScore(
      {
        patient_age: 70,
        patient_conditions: ["hypertension"],
        current_medications: ["warfarin"],
      },
      {
        service,
        logger,
      },
    );

    expect(response.isError).toBe(true);
    expect(response.content?.[0]).toMatchObject({ type: "text" });
  });

  it("hydrates medications from sharp_context when explicit list is empty", async () => {
    const service = {
      calculateSafetyScore: jest.fn().mockResolvedValue({
        requestId: "55555555-5555-4555-8555-555555555555",
        source: "rules-interactions",
        analysisProvider: "rule-based",
        riskLevel: "low",
        score: 95,
        grade: "A",
        medicationCount: 2,
        deductionTotal: 5,
        deductions: [
          {
            category: "Polypharmacy burden",
            points: 5,
            rationale: "test",
          },
        ],
        interactionSummary: {
          contraindicated: 0,
          major: 0,
          moderate: 1,
          minor: 0,
        },
        beersFlags: [],
        duplicateTherapeuticClasses: [],
        improvementOpportunities: [],
        potentialOptimizedScore: 100,
        summary: "hydrated summary",
        generatedAt: new Date().toISOString(),
      }),
    };

    const sharpContextService = {
      resolveMedications: jest
        .fn()
        .mockResolvedValue(["warfarin", "ibuprofen"]),
      resolveConditions: jest.fn().mockResolvedValue(["atrial fibrillation"]),
      propagateContext: jest.fn(),
      resolveAllergies: jest.fn(),
    };

    const response = await executeCalculatePatientSafetyScore(
      {
        current_medications: [],
        patient_conditions: [],
        sharp_context: {
          patient_id: "patient-123",
          fhir_endpoint: "https://fhir.example.com",
          auth_token: "token-123",
        },
      },
      {
        service,
        logger,
        sharpContextService,
      },
    );

    expect(response.isError).not.toBe(true);
    expect(sharpContextService.resolveMedications).toHaveBeenCalledTimes(1);
    expect(sharpContextService.propagateContext).toHaveBeenCalledTimes(1);
  });

  it("returns validation error when no medications and no SHARP hydration are available", async () => {
    const service = {
      calculateSafetyScore: jest.fn(),
    };

    const response = await executeCalculatePatientSafetyScore(
      {
        current_medications: [],
        patient_conditions: [],
      },
      {
        service,
        logger,
      },
    );

    expect(response.isError).toBe(true);
    expect(service.calculateSafetyScore).not.toHaveBeenCalled();
  });
});
