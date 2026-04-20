import type { FhirR4Client } from "../clients/fhirR4Client";
import type { Logger } from "../logging/logger";
import { cloneSharpContext, type SharpContext } from "../sharp/sharpContext";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function asUnique(values: string[]): string[] {
  const map = new Map<string, string>();

  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (!map.has(key)) {
      map.set(key, cleaned);
    }
  }

  return Array.from(map.values());
}

function extractCodeableConceptDisplay(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const textRaw = record["text"];
  if (typeof textRaw === "string" && textRaw.trim()) {
    return normalizeWhitespace(textRaw);
  }

  const coding = asArray(record["coding"])
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  for (const codeEntry of coding) {
    const displayRaw = codeEntry["display"];
    if (typeof displayRaw === "string" && displayRaw.trim()) {
      return normalizeWhitespace(displayRaw);
    }

    const codeRaw = codeEntry["code"];
    if (typeof codeRaw === "string" && codeRaw.trim()) {
      return normalizeWhitespace(codeRaw);
    }
  }

  return null;
}

function extractMedicationName(
  resource: Record<string, unknown>,
): string | null {
  const medicationCodeableConcept = extractCodeableConceptDisplay(
    resource["medicationCodeableConcept"],
  );
  if (medicationCodeableConcept) {
    return medicationCodeableConcept;
  }

  const medicationReference = asRecord(resource["medicationReference"]);
  if (medicationReference) {
    const displayRaw = medicationReference["display"];
    if (typeof displayRaw === "string" && displayRaw.trim()) {
      return normalizeWhitespace(displayRaw);
    }
  }

  return null;
}

function extractAllergyName(resource: Record<string, unknown>): string[] {
  const names: string[] = [];

  const codeDisplay = extractCodeableConceptDisplay(resource["code"]);
  if (codeDisplay) {
    names.push(codeDisplay);
  }

  const reactions = asArray(resource["reaction"])
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  for (const reaction of reactions) {
    const manifestations = asArray(reaction["manifestation"])
      .map((entry) => extractCodeableConceptDisplay(entry))
      .filter((entry): entry is string => typeof entry === "string");

    names.push(...manifestations);
  }

  return names;
}

function extractConditionName(
  resource: Record<string, unknown>,
): string | null {
  return extractCodeableConceptDisplay(resource["code"]);
}

/**
 * Contract for resolving and propagating SHARP context-derived patient data.
 */
export interface SharpContextDataService {
  resolveMedications(sharpContext: SharpContext): Promise<string[]>;
  resolveAllergies(sharpContext: SharpContext): Promise<string[]>;
  resolveConditions(sharpContext: SharpContext): Promise<string[]>;
  propagateContext(sharpContext: SharpContext): SharpContext;
}

/**
 * FHIR-backed SHARP context hydration service for medications, allergies, and conditions.
 */
export class SharpContextFhirService implements SharpContextDataService {
  public constructor(
    private readonly fhirClient: FhirR4Client,
    private readonly logger: Logger,
  ) {}

  public async resolveMedications(
    sharpContext: SharpContext,
  ): Promise<string[]> {
    const resources = await this.fhirClient.fetchPatientMedications(
      sharpContext.patientId,
      sharpContext.fhirEndpoint,
      sharpContext.authToken,
    );

    const names = resources
      .map((resource) => extractMedicationName(resource))
      .filter((entry): entry is string => Boolean(entry));

    const unique = asUnique(names);

    this.logger.info("SHARP medication hydration completed", {
      component: "sharp-context-fhir-service",
      hydratedMedicationCount: unique.length,
      hasWorkflowContext: Boolean(sharpContext.workflowId),
    });

    return unique;
  }

  public async resolveAllergies(sharpContext: SharpContext): Promise<string[]> {
    const resources = await this.fhirClient.fetchPatientAllergies(
      sharpContext.patientId,
      sharpContext.fhirEndpoint,
      sharpContext.authToken,
    );

    const names = resources.flatMap((resource) => extractAllergyName(resource));
    const unique = asUnique(names);

    this.logger.info("SHARP allergy hydration completed", {
      component: "sharp-context-fhir-service",
      hydratedAllergyCount: unique.length,
      hasWorkflowContext: Boolean(sharpContext.workflowId),
    });

    return unique;
  }

  public async resolveConditions(
    sharpContext: SharpContext,
  ): Promise<string[]> {
    const resources = await this.fhirClient.fetchPatientConditions(
      sharpContext.patientId,
      sharpContext.fhirEndpoint,
      sharpContext.authToken,
    );

    const names = resources
      .map((resource) => extractConditionName(resource))
      .filter((entry): entry is string => Boolean(entry));

    const unique = asUnique(names);

    this.logger.info("SHARP condition hydration completed", {
      component: "sharp-context-fhir-service",
      hydratedConditionCount: unique.length,
      hasWorkflowContext: Boolean(sharpContext.workflowId),
    });

    return unique;
  }

  public propagateContext(sharpContext: SharpContext): SharpContext {
    this.logger.info("Prepared SHARP context for downstream propagation", {
      component: "sharp-context-fhir-service",
      hasWorkflowContext: Boolean(sharpContext.workflowId),
      hasEncounterContext: Boolean(sharpContext.encounterId),
    });

    return cloneSharpContext(sharpContext);
  }
}
