import { Logger } from "../../src/logging/logger";
import { DailyMedClient } from "../../src/clients/dailyMedClient";

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createXmlResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: { "Content-Type": "application/xml" },
  });
}

describe("DailyMedClient", () => {
  const logger = new Logger("error", { test: true });

  function createClient(): DailyMedClient {
    return new DailyMedClient({
      baseUrl: "https://dailymed.nlm.nih.gov/dailymed",
      timeoutMs: 2000,
      cacheTtlMs: 60000,
      logger,
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fetches and parses contraindication-related sections from SPL XML", async () => {
    const xml = `
      <document>
        <component>
          <structuredBody>
            <component>
              <section>
                <title>4 CONTRAINDICATIONS</title>
                <text><paragraph>Contraindicated in patients with known hypersensitivity.</paragraph></text>
              </section>
            </component>
            <component>
              <section>
                <title>8.1 Pregnancy</title>
                <text><paragraph>Pregnancy Category X. Avoid due to fetal toxicity.</paragraph></text>
              </section>
            </component>
            <component>
              <section>
                <title>8.6 Renal Impairment</title>
                <text><paragraph>Dosage adjustment is recommended in renal impairment.</paragraph></text>
              </section>
            </component>
          </structuredBody>
        </component>
      </document>
    `;

    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({
          data: [{ setid: "SET-123", title: "AMOXICILLIN TABLET" }],
        }),
      )
      .mockResolvedValueOnce(createXmlResponse(xml));

    const client = createClient();

    const result = await client.getDrugLabelSections("amoxicillin");

    expect(result?.setId).toBe("SET-123");
    expect(result?.sections.contraindications.length).toBeGreaterThan(0);
    expect(result?.sections.pregnancy.length).toBeGreaterThan(0);
    expect(result?.sections.renal.length).toBeGreaterThan(0);
  });

  it("returns null when no DailyMed SPL results are available", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        data: [],
      }),
    );

    const client = createClient();

    const result = await client.getDrugLabelSections("unknown-medication");
    expect(result).toBeNull();
  });

  it("uses cache for repeated lookups of the same medication", async () => {
    const xml = `
      <document>
        <component>
          <section>
            <title>Warnings and Precautions</title>
            <text><paragraph>Monitor patient closely.</paragraph></text>
          </section>
        </component>
      </document>
    `;

    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({
          data: [{ setid: "SET-CACHE", title: "EXAMPLE DRUG" }],
        }),
      )
      .mockResolvedValueOnce(createXmlResponse(xml));

    const client = createClient();

    const first = await client.getDrugLabelSections("example drug");
    const second = await client.getDrugLabelSections("example drug");

    expect(first?.setId).toBe("SET-CACHE");
    expect(second?.setId).toBe("SET-CACHE");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws validation error for empty medication input", async () => {
    const client = createClient();

    await expect(client.getDrugLabelSections("   ")).rejects.toThrow(
      "Drug name cannot be empty",
    );
  });

  it("prefers strict title match while skipping entries without setid", async () => {
    const longText = "L".repeat(560);
    const xml = `
      <document>
        <component>
          <structuredBody>
            <component>
              <section>
                <title code="x">Warnings and Precautions</title>
                <text>
                  <paragraph>${longText}</paragraph>
                  <paragraph>Additional warning text.</paragraph>
                </text>
              </section>
            </component>
            <component>
              <section>
                <title>Kidney impairment</title>
                <text><paragraph>Use caution in kidney disease.</paragraph></text>
              </section>
            </component>
            <component>
              <section>
                <title>Liver impairment</title>
                <text><paragraph>Use caution in hepatic disease.</paragraph></text>
              </section>
            </component>
          </structuredBody>
        </component>
      </document>
    `;

    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({
          data: [
            { title: "entry-without-setid" },
            { setid: "SET-FIRST", title: "Unrelated title" },
            { setid: "SET-STRICT", title: "AMOXICILLIN-TABLET" },
          ],
        }),
      )
      .mockResolvedValueOnce(createXmlResponse(xml));

    const client = createClient();
    const result = await client.getDrugLabelSections("amoxicillin tablet");

    expect(result?.setId).toBe("SET-STRICT");
    expect(result?.sections.warnings.length).toBeGreaterThan(0);
    expect(result?.sections.warnings[0]?.endsWith("...")).toBe(true);
    expect(result?.sections.renal.length).toBeGreaterThan(0);
    expect(result?.sections.hepatic.length).toBeGreaterThan(0);
  });

  it("returns null when search payload omits data key", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({}));

    const client = createClient();
    const result = await client.getDrugLabelSections("missing-data-key");

    expect(result).toBeNull();
  });

  it("throws DAILYMED_PARSE_ERROR when search JSON cannot be parsed", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = createClient();

    await expect(
      client.getDrugLabelSections("amoxicillin"),
    ).rejects.toMatchObject({
      code: "DAILYMED_PARSE_ERROR",
    });
  });

  it("throws DAILYMED_PARSE_ERROR when SPL XML is invalid", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({
          data: [{ setid: "SET-XML", title: "INVALID XML DRUG" }],
        }),
      )
      .mockResolvedValueOnce(
        createXmlResponse("<document><section></document>"),
      );

    const client = createClient();
    jest
      .spyOn(
        (client as unknown as { parser: { parse: (xml: string) => unknown } })
          .parser,
        "parse",
      )
      .mockImplementation(() => {
        throw new Error("invalid xml");
      });

    await expect(
      client.getDrugLabelSections("invalid xml drug"),
    ).rejects.toMatchObject({
      code: "DAILYMED_PARSE_ERROR",
    });
  });

  it("throws DAILYMED_API_ERROR for non-OK HTTP status", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("bad gateway", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );

    const client = createClient();

    await expect(
      client.getDrugLabelSections("amoxicillin"),
    ).rejects.toMatchObject({
      code: "DAILYMED_API_ERROR",
    });
  });

  it("maps AbortError to DAILYMED_TIMEOUT", async () => {
    const abortError = new Error("timeout");
    abortError.name = "AbortError";

    jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    const client = createClient();

    await expect(
      client.getDrugLabelSections("amoxicillin"),
    ).rejects.toMatchObject({
      code: "DAILYMED_TIMEOUT",
    });
  });

  it("maps unexpected request failures to DAILYMED_API_ERROR", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"));

    const client = createClient();

    await expect(
      client.getDrugLabelSections("amoxicillin"),
    ).rejects.toMatchObject({
      code: "DAILYMED_API_ERROR",
    });
  });
});
