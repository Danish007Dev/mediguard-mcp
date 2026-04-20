import { Logger } from "../../src/logging/logger";
import { FhirR4Client } from "../../src/clients/fhirR4Client";

const runLiveTests = process.env["ENABLE_LIVE_FHIR_TESTS"] === "true";
const describeLive = runLiveTests ? describe : describe.skip;

describeLive("FhirR4Client live HAPI integration", () => {
  const logger = new Logger("error", { test: true, live: true });
  const endpoint =
    process.env["FHIR_TEST_ENDPOINT"]?.trim() || "https://hapi.fhir.org/baseR4";
  const token = process.env["FHIR_TEST_TOKEN"]?.trim() || "public-access-token";
  const patientId =
    process.env["FHIR_TEST_PATIENT_ID"]?.trim() ||
    "phase3-live-integration-patient-not-expected";

  const client = new FhirR4Client({
    timeoutMs: 15000,
    pageSize: 25,
    maxPages: 5,
    defaultTokenEndpoint: process.env["FHIR_DEFAULT_TOKEN_ENDPOINT"]?.trim(),
    logger,
  });

  it("fetches medications, allergies, and conditions from HAPI FHIR endpoint", async () => {
    const medications = await client.fetchPatientMedications(
      patientId,
      endpoint,
      token,
    );
    const allergies = await client.fetchPatientAllergies(
      patientId,
      endpoint,
      token,
    );
    const conditions = await client.fetchPatientConditions(
      patientId,
      endpoint,
      token,
    );

    expect(Array.isArray(medications)).toBe(true);
    expect(Array.isArray(allergies)).toBe(true);
    expect(Array.isArray(conditions)).toBe(true);

    expect(
      medications.every(
        (entry) => entry["resourceType"] === "MedicationRequest",
      ),
    ).toBe(true);
    expect(
      allergies.every(
        (entry) => entry["resourceType"] === "AllergyIntolerance",
      ),
    ).toBe(true);
    expect(
      conditions.every((entry) => entry["resourceType"] === "Condition"),
    ).toBe(true);
  }, 45000);
});
