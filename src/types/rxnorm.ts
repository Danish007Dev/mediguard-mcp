import type { NormalizedMedication } from "./medicationSafety";

export interface RxNormConceptProperties {
  rxcui: string;
  name: string;
  tty: string;
}

export interface RxNormNormalizationResult extends NormalizedMedication {
  correctedInput?: string;
}

export interface RxNormLookupOptions {
  allowApproximateFallback?: boolean;
}
