import type { CheckDrugInteractionsResult } from "../types/medicationSafety";

export interface DrugInteractionService {
  checkDrugInteractions(
    medications: string[],
    requestId: string,
  ): Promise<CheckDrugInteractionsResult>;
}
