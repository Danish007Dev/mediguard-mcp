import type {
  CheckDrugInteractionsResult,
  InteractionPatientContext,
} from "../types/medicationSafety";

export interface DrugInteractionService {
  checkDrugInteractions(
    medications: string[],
    requestId: string,
    patientContext?: InteractionPatientContext,
  ): Promise<CheckDrugInteractionsResult>;
}
