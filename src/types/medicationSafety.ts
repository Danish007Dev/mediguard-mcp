export type InteractionSeverity =
  | "minor"
  | "moderate"
  | "major"
  | "contraindicated";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface InteractionFinding {
  drugs: string[];
  severity: InteractionSeverity;
  mechanism: string;
  clinicalImpact: string;
  recommendations: string[];
  evidence: string;
}

export interface InteractionPatientContext {
  age?: number;
  conditions: string[];
  renalFunction?: string;
}

export interface LlmInteractionAnalysis {
  drug1: string;
  drug2: string;
  severity: "low" | "moderate" | "high";
  reasoning: string;
  mechanism: string;
  monitoringRecommendations: string[];
  saferAlternatives: string[];
}

export interface InteractionLlmTrace {
  traceId: string;
  cacheHit: boolean;
  attemptedProviders: Array<"groq" | "gemini" | "rule-based">;
  selectedProvider: "groq" | "gemini" | "rule-based";
  fallbackUsed: boolean;
  promptInteractionCount: number;
  patientContextUsed: {
    age: boolean;
    conditions: boolean;
    renalFunction: boolean;
  };
}

export interface InteractionLlmTelemetry {
  totalRequests: number;
  cacheHits: number;
  cacheHitRate: number;
  providerCalls: {
    groq: number;
    gemini: number;
    ruleBased: number;
  };
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  estimatedTotalTokens: number;
  estimatedSpendUsd: number;
}

export interface InteractionLlmSynthesis {
  overallRisk: "low" | "moderate" | "high";
  contextualizedSummary: string;
  interactionAnalyses: LlmInteractionAnalysis[];
  trace?: InteractionLlmTrace;
  telemetry?: InteractionLlmTelemetry;
}

export interface NormalizedMedication {
  input: string;
  normalizedName: string;
  rxcui: string;
  tty: string;
  strategy: "direct" | "spelling-suggestion" | "approximate" | "rxcui-input";
  genericMapped: boolean;
}

export interface CheckDrugInteractionsResult {
  requestId: string;
  source: "mock" | "rxnorm-openfda";
  analysisProvider: "groq" | "gemini" | "rule-based";
  riskLevel: RiskLevel;
  medications: string[];
  patientContext?: InteractionPatientContext;
  normalizedMedications: NormalizedMedication[];
  interactions: InteractionFinding[];
  summary: string;
  analysisRecommendations: string[];
  llmSynthesis?: InteractionLlmSynthesis;
  generatedAt: string;
}

export interface BeersCriteriaFlag {
  medication: string;
  reason: string;
  severity: "moderate" | "major";
  evidence: string;
}

export interface DuplicateTherapeuticClassFlag {
  className: string;
  medications: string[];
  risk: "low" | "medium" | "high";
  rationale: string;
}

export interface DeprescribingOpportunity {
  medication: string;
  rationale: string;
  suggestedAction: string;
  priority: "low" | "medium" | "high";
}

export interface AnalyzePolypharmacyResult {
  requestId: string;
  source: "rules-llm";
  analysisProvider: "groq" | "gemini" | "rule-based";
  riskLevel: RiskLevel;
  isElderly: boolean;
  medicationCount: number;
  beersFlags: BeersCriteriaFlag[];
  duplicateTherapeuticClasses: DuplicateTherapeuticClassFlag[];
  drugBurdenIndex: number;
  deprescribingOpportunities: DeprescribingOpportunity[];
  summary: string;
  analysisRecommendations: string[];
  generatedAt: string;
}

export type ContraindicationSeverity = "moderate" | "major" | "contraindicated";

export type ContraindicationTrigger =
  | "allergy"
  | "condition"
  | "lab"
  | "pregnancy"
  | "label-warning";

export interface ContraindicationFinding {
  medication: string;
  trigger: ContraindicationTrigger;
  severity: ContraindicationSeverity;
  rationale: string;
  recommendation: string;
  evidence: string;
  source: "rules" | "dailymed";
}

export interface ContraindicationLabelEvidence {
  setId?: string;
  title?: string;
  contraindications: string[];
  warnings: string[];
  pregnancy: string[];
  renal: string[];
  hepatic: string[];
}

export interface CheckContraindicationsResult {
  requestId: string;
  source: "rules-dailymed";
  analysisProvider: "groq" | "gemini" | "rule-based";
  riskLevel: RiskLevel;
  contraindicated: boolean;
  proposedMedication: string;
  contraindications: ContraindicationFinding[];
  summary: string;
  analysisRecommendations: string[];
  labelEvidence: ContraindicationLabelEvidence;
  generatedAt: string;
}

export interface SaferAlternativeOption {
  medication: string;
  therapeuticClass: string;
  safetyScore: number;
  formularyPreferred: boolean;
  avoidsRisks: string[];
  cautionFlags: string[];
  rationale: string;
}

export interface GetSaferAlternativesResult {
  requestId: string;
  source: "rules-formulary-llm";
  analysisProvider: "groq" | "gemini" | "rule-based";
  riskLevel: RiskLevel;
  proposedMedication: string;
  riskContext: string[];
  alternatives: SaferAlternativeOption[];
  summary: string;
  analysisRecommendations: string[];
  generatedAt: string;
}

export interface MedicationSafetyExplanationFinding {
  issue: string;
  severity: "minor" | "moderate" | "major" | "contraindicated";
  clinicalImpact: string;
  recommendedAction: string;
}

export interface ExplainMedicationSafetyResult {
  requestId: string;
  source: "template-llm";
  analysisProvider: "groq" | "gemini" | "rule-based";
  audience: "patient" | "provider";
  language: string;
  readingLevel: "grade-8" | "clinical";
  medication: string;
  riskLevel: RiskLevel;
  headline: string;
  explanation: string;
  keyPoints: string[];
  followUpQuestions: string[];
  disclaimer: string;
  generatedAt: string;
}
