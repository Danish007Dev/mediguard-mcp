import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Logger } from "../../src/logging/logger";
import { FhirR4Client } from "../../src/clients/fhirR4Client";

function writeJson(
  response: ServerResponse,
  payload: unknown,
  statusCode = 200,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

describe("FhirR4Client mock integration", () => {
  const logger = new Logger("error", { test: true });

  let server: Server;
  let baseUrl = "";
  const requests: Array<{ path: string; authorization?: string }> = [];

  beforeAll(async () => {
    server = createServer(
      (request: IncomingMessage, response: ServerResponse) => {
        const url = new URL(request.url ?? "/", baseUrl || "http://127.0.0.1");
        requests.push({
          path: `${url.pathname}${url.search}`,
          authorization: request.headers.authorization,
        });

        if (
          url.pathname === "/MedicationRequest" &&
          url.searchParams.get("page") === "2"
        ) {
          writeJson(response, {
            resourceType: "Bundle",
            entry: [
              {
                resource: {
                  resourceType: "MedicationRequest",
                  status: "active",
                  medicationCodeableConcept: { text: "metformin" },
                },
              },
            ],
          });
          return;
        }

        if (url.pathname === "/MedicationRequest") {
          writeJson(response, {
            resourceType: "Bundle",
            entry: [
              {
                resource: {
                  resourceType: "MedicationRequest",
                  status: "active",
                  medicationCodeableConcept: { text: "warfarin" },
                },
              },
            ],
            link: [
              {
                relation: "next",
                url: `${baseUrl}/MedicationRequest?page=2`,
              },
            ],
          });
          return;
        }

        if (url.pathname === "/AllergyIntolerance") {
          writeJson(response, {
            resourceType: "Bundle",
            entry: [
              {
                resource: {
                  resourceType: "AllergyIntolerance",
                  code: { text: "Penicillin allergy" },
                },
              },
            ],
          });
          return;
        }

        if (url.pathname === "/Condition") {
          writeJson(response, {
            resourceType: "Bundle",
            entry: [
              {
                resource: {
                  resourceType: "Condition",
                  clinicalStatus: {
                    coding: [{ code: "active" }],
                  },
                  code: { text: "Heart failure" },
                },
              },
              {
                resource: {
                  resourceType: "Condition",
                  clinicalStatus: {
                    coding: [{ code: "resolved" }],
                  },
                  code: { text: "Resolved bronchitis" },
                },
              },
            ],
          });
          return;
        }

        writeJson(response, { message: "Not found" }, 404);
      },
    );

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });

  it("fetches medications, allergies, and active conditions from a mock FHIR server", async () => {
    const client = new FhirR4Client({
      timeoutMs: 2000,
      pageSize: 2,
      maxPages: 5,
      logger,
    });

    const medications = await client.fetchPatientMedications(
      "patient-integration",
      baseUrl,
      "token-123",
    );
    const allergies = await client.fetchPatientAllergies(
      "patient-integration",
      baseUrl,
      "token-123",
    );
    const conditions = await client.fetchPatientConditions(
      "patient-integration",
      baseUrl,
      "token-123",
    );

    expect(medications).toHaveLength(2);
    expect(allergies).toHaveLength(1);
    expect(conditions).toHaveLength(1);

    expect(requests.length).toBeGreaterThanOrEqual(4);
    expect(
      requests.every((request) => request.authorization === "Bearer token-123"),
    ).toBe(true);

    const firstPath = requests[0]?.path ?? "";
    expect(firstPath).toContain("/MedicationRequest?");
    expect(firstPath).toContain("patient=patient-integration");
  });
});
