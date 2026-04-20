import { Logger } from "../../src/logging/logger";
import { RxNormClient } from "../../src/clients/rxNormClient";

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

function createTextResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

describe("RxNormClient", () => {
  const logger = new Logger("error", { test: true });

  function createClient(): RxNormClient {
    return new RxNormClient({
      baseUrl: "https://rxnav.nlm.nih.gov/REST",
      timeoutMs: 2000,
      cacheTtlMs: 60000,
      logger,
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("normalizes Tylenol to acetaminophen RxCUI 161", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({ idGroup: { rxnormId: ["202433"] } }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          properties: {
            rxcui: "202433",
            name: "Tylenol",
            tty: "BN",
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          minConceptGroup: {
            minConcept: [{ rxcui: "161", name: "acetaminophen", tty: "IN" }],
          },
        }),
      );

    const client = createClient();

    const result = await client.normalizeDrugName("Tylenol");

    expect(result.normalizedName).toBe("acetaminophen");
    expect(result.rxcui).toBe("161");
    expect(result.strategy).toBe("direct");
    expect(result.genericMapped).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("handles typo input through spelling suggestion", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({ idGroup: {} }))
      .mockResolvedValueOnce(
        createJsonResponse({
          suggestionGroup: {
            suggestionList: {
              suggestion: ["tylenol"],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({ idGroup: { rxnormId: ["202433"] } }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          properties: {
            rxcui: "202433",
            name: "Tylenol",
            tty: "BN",
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          minConceptGroup: {
            minConcept: [{ rxcui: "161", name: "acetaminophen", tty: "IN" }],
          },
        }),
      );

    const client = createClient();

    const result = await client.normalizeDrugName("tylenlo");

    expect(result.strategy).toBe("spelling-suggestion");
    expect(result.correctedInput).toBe("tylenlo");
    expect(result.normalizedName).toBe("acetaminophen");
  });

  it("parses XML fallback when JSON endpoint fails", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({ message: "error" }, 500))
      .mockResolvedValueOnce(
        createXmlResponse(
          "<rxnormdata><properties><rxcui>161</rxcui><name>acetaminophen</name><tty>IN</tty></properties></rxnormdata>",
        ),
      );

    const client = createClient();

    const properties = await client.getConceptProperties("161");

    expect(properties.rxcui).toBe("161");
    expect(properties.name).toBe("acetaminophen");
    expect(properties.tty).toBe("IN");
  });

  it("uses RxCUI input strategy when medication is numeric", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({
          properties: {
            rxcui: "161",
            name: "acetaminophen",
            tty: "IN",
          },
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ minConceptGroup: {} }));

    const client = createClient();
    const result = await client.normalizeDrugName("161");

    expect(result.strategy).toBe("rxcui-input");
    expect(result.rxcui).toBe("161");
    expect(result.genericMapped).toBe(false);
  });

  it("uses approximate fallback when direct and spelling suggestion fail", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({ idGroup: {} }))
      .mockResolvedValueOnce(
        createJsonResponse({ suggestionGroup: { suggestionList: {} } }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          approximateGroup: {
            candidate: [{ rxcui: "83367" }],
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          properties: {
            rxcui: "83367",
            name: "amoxicillin",
            tty: "IN",
          },
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ minConceptGroup: {} }));

    const client = createClient();
    const result = await client.normalizeDrugName("amoxcillin");

    expect(result.strategy).toBe("approximate");
    expect(result.normalizedName).toBe("amoxicillin");
  });

  it("throws RXNORM_NOT_FOUND when approximate fallback is disabled", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({ idGroup: {} }))
      .mockResolvedValueOnce(
        createJsonResponse({ suggestionGroup: { suggestionList: {} } }),
      );

    const client = createClient();

    await expect(
      client.normalizeDrugName("unknown-drug", {
        allowApproximateFallback: false,
      }),
    ).rejects.toMatchObject({
      code: "RXNORM_NOT_FOUND",
    });
  });

  it("extracts concept properties from propConceptGroup fallback shape", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        propConceptGroup: {
          propConcept: {
            rxcui: "161",
            name: "acetaminophen",
            tty: "IN",
          },
        },
      }),
    );

    const client = createClient();
    const result = await client.getConceptProperties("161");

    expect(result.name).toBe("acetaminophen");
  });

  it("throws validation error for invalid RxCUI input", async () => {
    const client = createClient();

    await expect(client.getConceptProperties("abc")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("throws RXNORM_NOT_FOUND when property payload lacks medication name", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        properties: {
          rxcui: "161",
          tty: "IN",
        },
      }),
    );

    const client = createClient();

    await expect(client.getConceptProperties("161")).rejects.toMatchObject({
      code: "RXNORM_NOT_FOUND",
    });
  });

  it("maps AbortError to RXNORM_TIMEOUT when both JSON and XML requests timeout", async () => {
    const abortError = new Error("timeout");
    abortError.name = "AbortError";

    jest.spyOn(globalThis, "fetch").mockRejectedValue(abortError);

    const client = createClient();

    await expect(client.getConceptProperties("161")).rejects.toMatchObject({
      code: "RXNORM_TIMEOUT",
    });
  });

  it("falls back from JSON parse error to XML parsing", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createTextResponse("not-json"))
      .mockResolvedValueOnce(
        createXmlResponse(
          "<rxnormdata><properties><rxcui>161</rxcui><name>acetaminophen</name><tty>IN</tty></properties></rxnormdata>",
        ),
      );

    const client = createClient();
    const result = await client.getConceptProperties("161");

    expect(result.rxcui).toBe("161");
  });

  it("maps unknown request failures to RXNORM_API_ERROR", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network issue"))
      .mockRejectedValueOnce(new Error("network issue"));

    const client = createClient();

    await expect(client.getConceptProperties("161")).rejects.toMatchObject({
      code: "RXNORM_API_ERROR",
    });
  });

  it("prefers IN/PIN generic concepts when multiple generic candidates exist", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({ idGroup: { rxnormId: ["202433"] } }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          properties: {
            rxcui: "202433",
            name: "Tylenol",
            tty: "BN",
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          minConceptGroup: {
            minConcept: [
              { rxcui: "123", name: "acetaminophen tablet", tty: "SCD" },
              { rxcui: "161", name: "acetaminophen", tty: "IN" },
            ],
          },
        }),
      );

    const client = createClient();
    const result = await client.normalizeDrugName("Tylenol");

    expect(result.rxcui).toBe("161");
    expect(result.genericMapped).toBe(true);
  });

  it("uses cache for concept properties on repeated requests", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        properties: {
          rxcui: "161",
          name: "acetaminophen",
          tty: "IN",
        },
      }),
    );

    const client = createClient();

    const first = await client.getConceptProperties("161");
    const second = await client.getConceptProperties("161");

    expect(first).toEqual(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
