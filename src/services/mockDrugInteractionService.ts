import { AppError } from "../errors/appError";
import type { DrugInteractionService } from "./drugInteractionService";
import type {
  CheckDrugInteractionsResult,
  InteractionPatientContext,
  InteractionFinding,
  InteractionSeverity,
  RiskLevel,
} from "../types/medicationSafety";

interface MockInteractionDefinition {
  drugs: [string, string];
  severity: InteractionSeverity;
  mechanism: string;
  clinicalImpact: string;
  recommendations: string[];
  evidence: string;
}

const MOCK_INTERACTIONS: MockInteractionDefinition[] = [
  {
    drugs: ["warfarin", "ibuprofen"],
    severity: "major",
    mechanism:
      "Combined anticoagulant and antiplatelet effects increase bleeding risk.",
    clinicalImpact:
      "Higher probability of gastrointestinal and intracranial bleeding events.",
    recommendations: [
      "Consider acetaminophen for pain control when clinically appropriate.",
      "If NSAID use is unavoidable, evaluate gastroprotection and monitor INR closely.",
      "Educate patient to report bleeding symptoms immediately.",
    ],
    evidence:
      "Mock evidence: representative of common high-risk interaction classes.",
  },
  {
    drugs: ["simvastatin", "clarithromycin"],
    severity: "contraindicated",
    mechanism: "CYP3A4 inhibition can markedly increase simvastatin exposure.",
    clinicalImpact: "Elevated risk of myopathy and rhabdomyolysis.",
    recommendations: [
      "Avoid concurrent use when possible.",
      "Consider alternate antibiotic or non-CYP3A4-metabolized statin.",
      "Monitor for muscle pain, weakness, and CK elevation if unavoidable.",
    ],
    evidence:
      "Mock evidence: representative of severe metabolism-mediated interactions.",
  },
];

function normalizeMedicationNames(medications: string[]): string[] {
  const uniqueByKey = new Map<string, string>();

  for (const medication of medications) {
    const cleaned = medication.trim();
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, cleaned);
    }
  }

  return Array.from(uniqueByKey.values());
}

function inferRiskLevel(interactions: InteractionFinding[]): RiskLevel {
  if (
    interactions.some(
      (interaction) => interaction.severity === "contraindicated",
    )
  ) {
    return "critical";
  }

  if (interactions.some((interaction) => interaction.severity === "major")) {
    return "high";
  }

  if (interactions.some((interaction) => interaction.severity === "moderate")) {
    return "medium";
  }

  return "low";
}

function findInteractions(medications: string[]): InteractionFinding[] {
  const medsSet = new Set(
    medications.map((medication) => medication.toLowerCase()),
  );

  return MOCK_INTERACTIONS.filter((interaction) =>
    interaction.drugs.every((drug) => medsSet.has(drug)),
  ).map((interaction) => ({
    drugs: interaction.drugs,
    severity: interaction.severity,
    mechanism: interaction.mechanism,
    clinicalImpact: interaction.clinicalImpact,
    recommendations: interaction.recommendations,
    evidence: interaction.evidence,
  }));
}

/**
 * Deterministic mock interaction service used for local development/testing paths.
 */
export class MockDrugInteractionService implements DrugInteractionService {
  public async checkDrugInteractions(
    medications: string[],
    requestId: string,
    patientContext?: InteractionPatientContext,
  ): Promise<CheckDrugInteractionsResult> {
    const normalizedMedications = normalizeMedicationNames(medications);

    if (normalizedMedications.length < 2) {
      throw new AppError(
        "At least two unique medication names are required for interaction checking.",
        "VALIDATION_ERROR",
        { minimumMedications: 2 },
      );
    }

    const interactions = findInteractions(normalizedMedications);
    const riskLevel = inferRiskLevel(interactions);

    const summary =
      interactions.length === 0
        ? "No mock interaction matches were found in the current dataset."
        : `Found ${interactions.length} potential interaction(s) using mock reference data.`;

    return {
      requestId,
      source: "mock",
      analysisProvider: "rule-based",
      riskLevel,
      medications: normalizedMedications,
      patientContext,
      normalizedMedications: normalizedMedications.map((name) => ({
        input: name,
        normalizedName: name,
        rxcui: "",
        tty: "UNKNOWN",
        strategy: "direct",
        genericMapped: false,
      })),
      interactions,
      summary,
      analysisRecommendations:
        interactions.length === 0
          ? ["Continue standard monitoring based on patient-specific factors."]
          : [
              "Review potential high-risk pairs and consider safer alternatives.",
            ],
      generatedAt: new Date().toISOString(),
    };
  }
}
