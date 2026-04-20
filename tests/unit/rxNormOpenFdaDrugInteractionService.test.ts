import { Logger } from "../../src/logging/logger";
import { RxNormOpenFdaDrugInteractionService } from "../../src/services/rxNormOpenFdaDrugInteractionService";

describe("RxNormOpenFdaDrugInteractionService", () => {
  const logger = new Logger("error", { test: true });

  const warfarinNormalization = {
    input: "warfarin",
    normalizedName: "warfarin",
    rxcui: "11289",
    tty: "IN",
    strategy: "direct" as const,
    genericMapped: false,
  };

  const ibuprofenNormalization = {
    input: "ibuprofen",
    normalizedName: "ibuprofen",
    rxcui: "5640",
    tty: "IN",
    strategy: "direct" as const,
    genericMapped: false,
  };

  function buildService(options?: {
    openFdaImplementation?: (drugName: string) => unknown;
    synthesisImplementation?: () => unknown;
  }): RxNormOpenFdaDrugInteractionService {
    const rxNormClient = {
      normalizeDrugName: jest
        .fn()
        .mockResolvedValueOnce(warfarinNormalization)
        .mockResolvedValueOnce(ibuprofenNormalization),
      getConceptProperties: jest
        .fn()
        .mockResolvedValueOnce({ rxcui: "11289", name: "warfarin", tty: "IN" })
        .mockResolvedValueOnce({ rxcui: "5640", name: "ibuprofen", tty: "IN" }),
    };

    const openFdaClient = {
      getDrugLabelInteractions: jest.fn(async (drugName: string) => {
        if (options?.openFdaImplementation) {
          return options.openFdaImplementation(drugName);
        }

        return null;
      }),
    };

    const synthesisService = options?.synthesisImplementation
      ? {
          synthesize: jest.fn(async () => options.synthesisImplementation?.()),
        }
      : undefined;

    return new RxNormOpenFdaDrugInteractionService(
      rxNormClient as never,
      openFdaClient as never,
      logger,
      synthesisService as never,
    );
  }

  it("returns interaction findings from OpenFDA text matches", async () => {
    const service = buildService({
      openFdaImplementation: (drugName) => {
        if (drugName === "warfarin") {
          return {
            queriedDrugName: "warfarin",
            setId: "SET-WARFARIN",
            aliases: ["warfarin"],
            interactionText: [
              "Concurrent use with ibuprofen increases bleeding risk and serious hemorrhage.",
            ],
            warningText: [],
          };
        }

        return {
          queriedDrugName: "ibuprofen",
          setId: "SET-IBUPROFEN",
          aliases: ["ibuprofen"],
          interactionText: [],
          warningText: [],
        };
      },
    });

    const result = await service.checkDrugInteractions(
      ["warfarin", "ibuprofen"],
      "33333333-3333-4333-8333-333333333333",
    );

    expect(result.source).toBe("rxnorm-openfda");
    expect(result.interactions.length).toBeGreaterThan(0);
    expect(["major", "contraindicated"]).toContain(
      result.interactions[0].severity,
    );
    expect(["high", "critical"]).toContain(result.riskLevel);
  });

  it("classifies contraindicated severity from direct warning language", async () => {
    const service = buildService({
      openFdaImplementation: (drugName) => {
        if (drugName === "warfarin") {
          return {
            queriedDrugName: "warfarin",
            setId: "SET-WARFARIN",
            aliases: ["warfarin"],
            interactionText: [
              "Do not use together with ibuprofen due to severe bleeding risk.",
            ],
            warningText: [],
          };
        }

        return {
          queriedDrugName: "ibuprofen",
          setId: "SET-IBUPROFEN",
          aliases: ["ibuprofen"],
          interactionText: [],
          warningText: [],
        };
      },
    });

    const result = await service.checkDrugInteractions(
      ["warfarin", "ibuprofen"],
      "23333333-3333-4333-8333-333333333333",
    );

    expect(result.interactions[0]?.severity).toBe("contraindicated");
    expect(result.riskLevel).toBe("critical");
  });

  it("detects class-based interactions when alias mention is absent", async () => {
    const service = buildService({
      openFdaImplementation: (drugName) => {
        if (drugName === "warfarin") {
          return {
            queriedDrugName: "warfarin",
            setId: "SET-WARFARIN",
            aliases: ["warfarin"],
            interactionText: [],
            warningText: [],
          };
        }

        return {
          queriedDrugName: "ibuprofen",
          setId: "SET-IBUPROFEN",
          aliases: ["ibuprofen"],
          interactionText: [
            "Use caution when this NSAID is combined with an anticoagulant due to bleeding.",
          ],
          warningText: [],
        };
      },
    });

    const result = await service.checkDrugInteractions(
      ["warfarin", "ibuprofen"],
      "34444444-4444-4444-8444-444444444444",
    );

    expect(result.interactions.length).toBeGreaterThan(0);
    expect(result.interactions[0]?.evidence).toContain(
      "OpenFDA drug label interactions",
    );
  });

  it("falls back to safety rules when OpenFDA text is unavailable", async () => {
    const service = buildService({
      openFdaImplementation: () => null,
    });

    const result = await service.checkDrugInteractions(
      ["warfarin", "ibuprofen"],
      "44444444-4444-4444-8444-444444444444",
    );

    expect(result.interactions.length).toBeGreaterThan(0);
    expect(result.interactions[0].evidence.toLowerCase()).toContain(
      "fallback rule",
    );
  });

  it("continues analysis when one OpenFDA lookup throws", async () => {
    const service = buildService({
      openFdaImplementation: (drugName) => {
        if (drugName === "warfarin") {
          throw new Error("OpenFDA unavailable");
        }

        return null;
      },
    });

    const result = await service.checkDrugInteractions(
      ["warfarin", "ibuprofen"],
      "54444444-4444-4444-8444-444444444444",
    );

    expect(result.interactions.length).toBeGreaterThan(0);
    expect(result.interactions[0]?.evidence.toLowerCase()).toContain(
      "fallback rule",
    );
  });

  it("returns rule-based synthesis when synthesis engine throws", async () => {
    const service = buildService({
      openFdaImplementation: () => null,
      synthesisImplementation: () => {
        throw new Error("Synthesis unavailable");
      },
    });

    const result = await service.checkDrugInteractions(
      ["warfarin", "ibuprofen"],
      "64444444-4444-4444-8444-444444444444",
    );

    expect(result.analysisProvider).toBe("rule-based");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("builds concept context from RxCUI properties when pre-resolved data is not provided", async () => {
    const rxNormClient = {
      normalizeDrugName: jest.fn(),
      getConceptProperties: jest
        .fn()
        .mockResolvedValueOnce({ rxcui: "11289", name: "warfarin", tty: "IN" })
        .mockResolvedValueOnce({ rxcui: "5640", name: "ibuprofen", tty: "IN" }),
    };

    const openFdaClient = {
      getDrugLabelInteractions: jest.fn().mockResolvedValue(null),
    };

    const service = new RxNormOpenFdaDrugInteractionService(
      rxNormClient as never,
      openFdaClient as never,
      logger,
    );

    const findings = await service.getDrugInteractionsForRxcuis([
      "11289",
      "5640",
    ]);

    expect(rxNormClient.getConceptProperties).toHaveBeenCalledTimes(2);
    expect(findings.length).toBeGreaterThan(0);
  });

  it("returns empty findings when fewer than two RxCUIs are provided", async () => {
    const service = buildService();
    const findings = await service.getDrugInteractionsForRxcuis(["11289"]);
    expect(findings).toEqual([]);
  });

  it("throws validation error when fewer than two unique medications are supplied", async () => {
    const service = buildService();

    await expect(
      service.checkDrugInteractions(
        ["warfarin", "warfarin"],
        "74444444-4444-4444-8444-444444444444",
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
