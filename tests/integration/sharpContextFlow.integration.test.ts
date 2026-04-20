import { Logger } from "../../src/logging/logger";
import { executeAnalyzePolypharmacy } from "../../src/tools/analyzePolypharmacy";
import { executeCheckContraindications } from "../../src/tools/checkContraindications";
import { executeCheckDrugInteractions } from "../../src/tools/checkDrugInteractions";
import { executeExplainMedicationSafety } from "../../src/tools/explainMedicationSafety";
import { executeGetSaferAlternatives } from "../../src/tools/getSaferAlternatives";

describe("SHARP context end-to-end tool flow", () => {
  const logger = new Logger("error", { test: true, sharp: true });

  const sharpContext = {
    patient_id: "patient-123",
    fhir_endpoint: "https://fhir.example.com",
    auth_token: "token-123",
    workflow_id: "workflow-abc",
  };

  function createSharpContextService() {
    return {
      resolveMedications: jest
        .fn()
        .mockResolvedValue(["warfarin", "ibuprofen"]),
      resolveAllergies: jest.fn().mockResolvedValue(["ibuprofen"]),
      resolveConditions: jest
        .fn()
        .mockResolvedValue(["chronic kidney disease"]),
      propagateContext: jest.fn((context) => context),
    };
  }

  it("hydrates all tools from sharp_context and propagates context downstream", async () => {
    const sharpContextService = createSharpContextService();

    const interactionService = {
      checkDrugInteractions: jest.fn().mockResolvedValue({
        requestId: "10000000-0000-4000-8000-000000000001",
        source: "mock",
        analysisProvider: "rule-based",
        riskLevel: "high",
        medications: ["warfarin", "ibuprofen"],
        normalizedMedications: [],
        interactions: [],
        summary: "summary",
        analysisRecommendations: [],
        generatedAt: new Date().toISOString(),
      }),
    };

    const polypharmacyService = {
      analyzePolypharmacy: jest.fn().mockResolvedValue({
        requestId: "10000000-0000-4000-8000-000000000002",
        source: "rules-llm",
        analysisProvider: "rule-based",
        riskLevel: "medium",
        isElderly: false,
        medicationCount: 2,
        beersFlags: [],
        duplicateTherapeuticClasses: [],
        drugBurdenIndex: 0,
        deprescribingOpportunities: [],
        summary: "summary",
        analysisRecommendations: [],
        generatedAt: new Date().toISOString(),
      }),
    };

    const contraindicationService = {
      checkContraindications: jest.fn().mockResolvedValue({
        requestId: "10000000-0000-4000-8000-000000000003",
        source: "rules-dailymed",
        analysisProvider: "rule-based",
        riskLevel: "medium",
        contraindicated: false,
        proposedMedication: "metformin",
        contraindications: [],
        summary: "summary",
        analysisRecommendations: [],
        labelEvidence: {
          contraindications: [],
          warnings: [],
          pregnancy: [],
          renal: [],
          hepatic: [],
        },
        generatedAt: new Date().toISOString(),
      }),
    };

    const alternativesService = {
      getSaferAlternatives: jest.fn().mockResolvedValue({
        requestId: "10000000-0000-4000-8000-000000000004",
        source: "rules-formulary-llm",
        analysisProvider: "rule-based",
        riskLevel: "high",
        proposedMedication: "ibuprofen",
        riskContext: ["context"],
        alternatives: [],
        summary: "summary",
        analysisRecommendations: [],
        generatedAt: new Date().toISOString(),
      }),
    };

    const explanationService = {
      explainMedicationSafety: jest.fn().mockResolvedValue({
        requestId: "10000000-0000-4000-8000-000000000005",
        source: "template-llm",
        analysisProvider: "rule-based",
        audience: "patient",
        language: "en",
        readingLevel: "grade-8",
        medication: "ibuprofen",
        riskLevel: "high",
        headline: "headline",
        explanation: "explanation",
        keyPoints: [],
        followUpQuestions: [],
        disclaimer: "disclaimer",
        generatedAt: new Date().toISOString(),
      }),
    };

    const interactionResult = await executeCheckDrugInteractions(
      {
        medications: [],
        sharp_context: sharpContext,
      },
      {
        service: interactionService,
        logger,
        sharpContextService,
      },
    );

    const polyResult = await executeAnalyzePolypharmacy(
      {
        patient_age: 66,
        current_medications: [],
        patient_conditions: [],
        sharp_context: sharpContext,
      },
      {
        service: polypharmacyService,
        logger,
        sharpContextService,
      },
    );

    const contraindicationResult = await executeCheckContraindications(
      {
        proposed_medication: "metformin",
        patient_allergies: [],
        patient_conditions: [],
        sharp_context: sharpContext,
      },
      {
        service: contraindicationService,
        logger,
        sharpContextService,
      },
    );

    const alternativesResult = await executeGetSaferAlternatives(
      {
        proposed_medication: "ibuprofen",
        current_medications: [],
        patient_allergies: [],
        patient_conditions: [],
        formulary_preferred: [],
        max_alternatives: 3,
        sharp_context: sharpContext,
      },
      {
        service: alternativesService,
        logger,
        sharpContextService,
      },
    );

    const explanationResult = await executeExplainMedicationSafety(
      {
        audience: "patient",
        language: "en",
        medication: "ibuprofen",
        risk_level: "high",
        findings: [],
        recommendations: [],
        sharp_context: sharpContext,
      },
      {
        service: explanationService,
        logger,
        sharpContextService,
      },
    );

    expect(interactionResult.isError).not.toBe(true);
    expect(polyResult.isError).not.toBe(true);
    expect(contraindicationResult.isError).not.toBe(true);
    expect(alternativesResult.isError).not.toBe(true);
    expect(explanationResult.isError).not.toBe(true);

    expect(interactionService.checkDrugInteractions).toHaveBeenCalledWith(
      expect.arrayContaining(["warfarin", "ibuprofen"]),
      expect.any(String),
      expect.objectContaining({
        conditions: expect.arrayContaining(["chronic kidney disease"]),
      }),
    );

    expect(polypharmacyService.analyzePolypharmacy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMedications: expect.arrayContaining(["warfarin", "ibuprofen"]),
        patientConditions: expect.arrayContaining(["chronic kidney disease"]),
      }),
      expect.any(String),
    );

    expect(contraindicationService.checkContraindications).toHaveBeenCalledWith(
      expect.objectContaining({
        patientAllergies: expect.arrayContaining(["ibuprofen"]),
        patientConditions: expect.arrayContaining(["chronic kidney disease"]),
      }),
      expect.any(String),
    );

    expect(alternativesService.getSaferAlternatives).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMedications: expect.arrayContaining(["warfarin", "ibuprofen"]),
        patientAllergies: expect.arrayContaining(["ibuprofen"]),
        patientConditions: expect.arrayContaining(["chronic kidney disease"]),
      }),
      expect.any(String),
    );

    expect(explanationService.explainMedicationSafety).toHaveBeenCalledWith(
      expect.objectContaining({
        recommendations: expect.arrayContaining([
          "Confirm this medication against the patient's active FHIR medication list before prescribing.",
        ]),
        findings: expect.arrayContaining([
          expect.objectContaining({
            issue: "Potential allergy mismatch from SHARP context",
          }),
        ]),
      }),
      expect.any(String),
    );

    expect(sharpContextService.propagateContext).toHaveBeenCalledTimes(5);
  });
});
