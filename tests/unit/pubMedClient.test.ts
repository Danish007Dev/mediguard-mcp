import { Logger } from "../../src/logging/logger";
import { PubMedClient } from "../../src/clients/pubMedClient";

describe("PubMedClient", () => {
  const logger = new Logger("error", { test: true });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createClient(): PubMedClient {
    return new PubMedClient({
      baseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
      timeoutMs: 1000,
      cacheTtlMs: 60_000,
      logger,
    });
  }

  function createClientWithOverrides(
    overrides: Partial<{
      timeoutMs: number;
      maxRetries: number;
      circuitBreakerFailureThreshold: number;
      circuitBreakerCooldownMs: number;
      contactEmail: string;
      apiKey: string;
    }>,
  ): PubMedClient {
    return new PubMedClient({
      baseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
      timeoutMs: overrides.timeoutMs ?? 1000,
      cacheTtlMs: 60_000,
      logger,
      maxRetries: overrides.maxRetries,
      circuitBreakerFailureThreshold: overrides.circuitBreakerFailureThreshold,
      circuitBreakerCooldownMs: overrides.circuitBreakerCooldownMs,
      contactEmail: overrides.contactEmail,
      apiKey: overrides.apiKey,
    });
  }

  it("throws validation error for empty drug names", async () => {
    const client = createClient();

    await expect(client.getInteractionEvidence("", "ibuprofen")).rejects.toMatchObject(
      {
        code: "VALIDATION_ERROR",
      },
    );
  });

  it("returns normalized evidence summary from esearch/esummary payloads", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            esearchresult: {
              idlist: ["12345", "67890"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              uids: ["12345", "67890"],
              "12345": {
                title: "Randomized trial of warfarin and ibuprofen interaction",
                fulljournalname: "Clinical Journal",
                pubdate: "2022",
              },
              "67890": {
                title: "Systematic review of anticoagulant and NSAID bleeding",
                source: "Pharmacotherapy",
                pubdate: "2021",
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const client = createClient();
    const result = await client.getInteractionEvidence("warfarin", "ibuprofen");

    expect(result).not.toBeNull();
    expect(result?.evidenceLevel).toBe("A");
    expect(result?.studyCount).toBe(2);
    expect(result?.studies[0]?.pmid).toBe("12345");
    expect(result?.studies[0]?.link).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/12345/",
    );
  });

  it("returns cached result for repeated lookups of the same pair", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            esearchresult: {
              idlist: ["12345"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              uids: ["12345"],
              "12345": {
                title: "Case report for interaction",
                source: "Journal",
                pubdate: "2020",
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const client = createClient();

    const first = await client.getInteractionEvidence("warfarin", "ibuprofen");
    const second = await client.getInteractionEvidence("ibuprofen", "warfarin");

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("maps AbortError to PUBMED_TIMEOUT", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    jest.spyOn(globalThis, "fetch").mockRejectedValue(abortError);

    const client = createClient();

    await expect(
      client.getInteractionEvidence("warfarin", "ibuprofen"),
    ).rejects.toMatchObject({
      code: "PUBMED_TIMEOUT",
    });
  });

  it("maps non-OK status to PUBMED_API_ERROR", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    const client = createClient();

    await expect(
      client.getInteractionEvidence("warfarin", "ibuprofen"),
    ).rejects.toMatchObject({
      code: "PUBMED_API_ERROR",
    });
  });

  it("retries on transient network failure and succeeds", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            esearchresult: {
              idlist: ["44444"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              uids: ["44444"],
              "44444": {
                title: "Retrospective study of adverse events",
                source: "Clinical Review",
                pubdate: "2022",
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const client = createClient();
    const result = await client.getInteractionEvidence("drug-r", "drug-s");

    expect(result).not.toBeNull();
    expect(result?.studyCount).toBe(1);
  });

  it("retries on 503 responses before succeeding", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("busy", {
          status: 503,
          statusText: "Service Unavailable",
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            esearchresult: {
              idlist: ["55555"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              uids: ["55555"],
              "55555": {
                title: "Cohort outcomes for medication interaction",
                source: "Medicine",
                pubdate: "2021",
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const client = createClient();
    const result = await client.getInteractionEvidence("drug-t", "drug-u");

    expect(result).not.toBeNull();
    expect(result?.studyCount).toBe(1);
  });

  it("infers evidence level B from cohort-style studies", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            esearchresult: {
              idlist: ["11111"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              uids: ["11111"],
              "11111": {
                title: "Prospective cohort evaluation of interaction risk",
                source: "Clinical Outcomes",
                pubdate: "2022",
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const client = createClient();
    const result = await client.getInteractionEvidence("drug-a", "drug-b");

    expect(result?.evidenceLevel).toBe("B");
  });

  it("infers evidence level C from case-report studies", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            esearchresult: {
              idlist: ["22222"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              uids: ["22222"],
              "22222": {
                title: "Case report of severe interaction in outpatient setting",
                source: "Case Medicine",
                pubdate: "2021",
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const client = createClient();
    const result = await client.getInteractionEvidence("drug-c", "drug-d");

    expect(result?.evidenceLevel).toBe("C");
  });

  it("infers evidence level D when no stronger study keywords exist", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            esearchresult: {
              idlist: ["33333"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              uids: ["33333"],
              "33333": {
                title: "Drug safety update from clinical newsletter",
                source: "Practice Update",
                pubdate: "2020",
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const client = createClient();
    const result = await client.getInteractionEvidence("drug-e", "drug-f");

    expect(result?.evidenceLevel).toBe("D");
  });

  it("returns null when esearch returns no PMIDs", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          esearchresult: {
            idlist: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const client = createClient();
    const result = await client.getInteractionEvidence("drug-g", "drug-h");

    expect(result).toBeNull();
  });

  it("sends configured email and api key query params", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            esearchresult: {
              idlist: ["66666"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              uids: ["66666"],
              "66666": {
                title: "Prospective cohort interaction report",
                source: "Safety Journal",
                pubdate: "2020",
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const client = createClientWithOverrides({
      contactEmail: "team@example.com",
      apiKey: "demo-pubmed-key",
    });

    await client.getInteractionEvidence("drug-x", "drug-y");

    const firstCall = fetchSpy.mock.calls[0]?.[0];
    expect(typeof firstCall).toBe("string");

    if (typeof firstCall === "string") {
      const url = new URL(firstCall);
      expect(url.searchParams.get("email")).toBe("team@example.com");
      expect(url.searchParams.get("api_key")).toBe("demo-pubmed-key");
    }
  });

  it("opens circuit after repeated failures and short-circuits subsequent calls", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed"));

    const client = createClientWithOverrides({
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerCooldownMs: 60_000,
    });

    await expect(
      client.getInteractionEvidence("drug-a", "drug-b"),
    ).rejects.toMatchObject({
      code: "PUBMED_API_ERROR",
    });

    const second = await client.getInteractionEvidence("drug-c", "drug-d");

    expect(second).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("allows calls again after circuit cooldown", async () => {
    let now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);

    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            esearchresult: {
              idlist: ["77777"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              uids: ["77777"],
              "77777": {
                title: "Systematic review for interaction evidence",
                source: "Journal of Safety",
                pubdate: "2023",
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const client = createClientWithOverrides({
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerCooldownMs: 1,
    });

    await expect(
      client.getInteractionEvidence("drug-e", "drug-f"),
    ).rejects.toMatchObject({
      code: "PUBMED_API_ERROR",
    });

    now += 2_000;

    const recovered = await client.getInteractionEvidence("drug-g", "drug-h");

    expect(recovered).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
