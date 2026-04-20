import { Logger } from "../../src/logging/logger";
import { OpenFdaClient } from "../../src/clients/openFdaClient";

describe("OpenFdaClient", () => {
  const logger = new Logger("error", { test: true });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createClient(): OpenFdaClient {
    return new OpenFdaClient({
      baseUrl: "https://api.fda.gov",
      timeoutMs: 1000,
      cacheTtlMs: 60_000,
      logger,
    });
  }

  it("throws validation error for empty drug names", async () => {
    const client = createClient();
    await expect(client.getDrugLabelInteractions("  ")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("returns null for 404 and uses cached null on repeated lookup", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 404 }));

    const client = createClient();

    const first = await client.getDrugLabelInteractions("unknown-drug");
    const second = await client.getDrugLabelInteractions("unknown-drug");

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("parses interactions, warnings, aliases, and setId from payload", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              set_id: "SET-123",
              drug_interactions: ["  Interacts with warfarin.  "],
              warnings_and_cautions: ["  Monitor renal function.  "],
              openfda: {
                generic_name: ["Ibuprofen"],
                brand_name: ["Advil"],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const client = createClient();
    const result = await client.getDrugLabelInteractions("ibuprofen");

    expect(result).not.toBeNull();
    expect(result?.setId).toBe("SET-123");
    expect(result?.interactionText).toEqual(["Interacts with warfarin."]);
    expect(result?.warningText).toEqual(["Monitor renal function."]);
    expect(result?.aliases).toEqual(
      expect.arrayContaining(["Ibuprofen", "Advil", "ibuprofen"]),
    );
  });

  it("returns null when payload has no results array", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ metadata: { found: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = createClient();
    const result = await client.getDrugLabelInteractions("metformin");

    expect(result).toBeNull();
  });

  it("throws OPENFDA_API_ERROR on non-OK status", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const client = createClient();

    await expect(
      client.getDrugLabelInteractions("warfarin"),
    ).rejects.toMatchObject({
      code: "OPENFDA_API_ERROR",
    });
  });

  it("maps AbortError to OPENFDA_TIMEOUT", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    const client = createClient();

    await expect(
      client.getDrugLabelInteractions("warfarin"),
    ).rejects.toMatchObject({
      code: "OPENFDA_TIMEOUT",
    });
  });

  it("maps generic request errors to OPENFDA_API_ERROR", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"));

    const client = createClient();

    await expect(
      client.getDrugLabelInteractions("warfarin"),
    ).rejects.toMatchObject({
      code: "OPENFDA_API_ERROR",
    });
  });

  it("returns null when first results entry is not an object", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [null] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = createClient();
    const result = await client.getDrugLabelInteractions("metformin");

    expect(result).toBeNull();
  });

  it("coerces non-array label fields to empty arrays", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              set_id: "SET-999",
              drug_interactions: "not-an-array",
              warnings_and_cautions: 42,
              openfda: {
                generic_name: "metformin",
                brand_name: null,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const client = createClient();
    const result = await client.getDrugLabelInteractions("metformin");

    expect(result).not.toBeNull();
    expect(result?.interactionText).toEqual([]);
    expect(result?.warningText).toEqual([]);
    expect(result?.aliases).toEqual(["metformin"]);
  });

  it("aborts request when timeout callback fires", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    const setTimeoutSpy = jest
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((handler: TimerHandler) => {
        if (typeof handler === "function") {
          handler();
        }

        return 0 as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);

    jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    const client = createClient();

    await expect(
      client.getDrugLabelInteractions("warfarin"),
    ).rejects.toMatchObject({
      code: "OPENFDA_TIMEOUT",
    });

    expect(setTimeoutSpy).toHaveBeenCalled();
  });
});
