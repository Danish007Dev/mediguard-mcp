export type InteractionSeverity =
  | 'minor'
  | 'moderate'
  | 'major'
  | 'contraindicated';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface InteractionFinding {
  drugs: string[];
  severity: InteractionSeverity;
  mechanism: string;
  clinicalImpact: string;
  recommendations: string[];
  evidence: string;
}

export interface CheckDrugInteractionsResult {
  requestId: string;
  source: 'mock';
  riskLevel: RiskLevel;
  medications: string[];
  interactions: InteractionFinding[];
  summary: string;
  generatedAt: string;
}
