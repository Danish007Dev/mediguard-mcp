import { XMLParser } from "fast-xml-parser";
import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type {
  RxNormConceptProperties,
  RxNormLookupOptions,
  RxNormNormalizationResult,
} from "../types/rxnorm";
import { TtlCache } from "../utils/ttlCache";

interface RxNormClientConfig {
  baseUrl: string;
  timeoutMs: number;
  cacheTtlMs: number;
  logger: Logger;
}

type Strategy =
  | "direct"
  | "spelling-suggestion"
  | "approximate"
  | "rxcui-input";

const RXCUI_INPUT_REGEX = /^\d+$/;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function pickPath<T>(obj: unknown, path: string[]): T | undefined {
  let cursor: unknown = obj;

  for (const key of path) {
    const record = asRecord(cursor);
    if (!record || !(key in record)) {
      return undefined;
    }

    cursor = record[key];
  }

  return cursor as T;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * RxNorm client with JSON-first/XML-fallback parsing and normalization caching.
 */
export class RxNormClient {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
    trimValues: true,
  });

  private readonly normalizationCache: TtlCache<
    string,
    RxNormNormalizationResult
  >;
  private readonly propertiesCache: TtlCache<string, RxNormConceptProperties>;

  public constructor(private readonly config: RxNormClientConfig) {
    this.normalizationCache = new TtlCache(config.cacheTtlMs);
    this.propertiesCache = new TtlCache(config.cacheTtlMs);
  }

  public async normalizeDrugName(
    medication: string,
    options: RxNormLookupOptions = {},
  ): Promise<RxNormNormalizationResult> {
    const normalizedInput = normalizeWhitespace(medication);
    if (!normalizedInput) {
      throw new AppError(
        "Medication name cannot be empty.",
        "VALIDATION_ERROR",
      );
    }

    const cacheKey = normalizedInput.toLowerCase();
    const cached = this.normalizationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const allowApproximateFallback = options.allowApproximateFallback ?? true;

    const directById = await this.tryResolveRxcuiInput(normalizedInput);
    if (directById) {
      this.normalizationCache.set(cacheKey, directById);
      return directById;
    }

    const direct = await this.findByName(normalizedInput, "direct");
    if (direct) {
      this.normalizationCache.set(cacheKey, direct);
      return direct;
    }

    const suggestedInput = await this.findSpellingSuggestion(normalizedInput);
    if (suggestedInput) {
      const suggested = await this.findByName(
        suggestedInput,
        "spelling-suggestion",
        normalizedInput,
      );
      if (suggested) {
        this.normalizationCache.set(cacheKey, suggested);
        return suggested;
      }
    }

    if (allowApproximateFallback) {
      const approximateRxcui = await this.findApproximateMatch(normalizedInput);
      if (approximateRxcui) {
        const approximateResult = await this.resolveFinalConcept(
          normalizedInput,
          approximateRxcui,
          "approximate",
        );
        this.normalizationCache.set(cacheKey, approximateResult);
        return approximateResult;
      }
    }

    throw new AppError(
      `Unable to normalize medication name with RxNorm: ${normalizedInput}`,
      "RXNORM_NOT_FOUND",
      { medication: normalizedInput },
    );
  }

  public async getConceptProperties(
    rxcui: string,
  ): Promise<RxNormConceptProperties> {
    const normalizedRxcui = normalizeWhitespace(rxcui);
    if (!RXCUI_INPUT_REGEX.test(normalizedRxcui)) {
      throw new AppError(`Invalid RxCUI: ${rxcui}`, "VALIDATION_ERROR");
    }

    const cached = this.propertiesCache.get(normalizedRxcui);
    if (cached) {
      return cached;
    }

    const response = await this.requestRxNorm(
      `rxcui/${normalizedRxcui}/properties`,
      {},
    );
    const root = this.unwrapRxNormRoot(response);

    const properties =
      pickPath<Record<string, unknown>>(root, ["properties"]) ??
      pickPath<Record<string, unknown>>(root, [
        "propConceptGroup",
        "propConcept",
      ]);

    const rawRxcui = properties?.["rxcui"];
    const rawName = properties?.["name"];
    const rawTty = properties?.["tty"];

    const parsedRxcui =
      typeof rawRxcui === "string" ? rawRxcui : normalizedRxcui;
    const parsedName = typeof rawName === "string" ? rawName : undefined;
    const parsedTty = typeof rawTty === "string" ? rawTty : "UNKNOWN";

    if (!parsedName) {
      throw new AppError(
        `RxNorm properties not found for RxCUI ${normalizedRxcui}`,
        "RXNORM_NOT_FOUND",
      );
    }

    const result = {
      rxcui: parsedRxcui,
      name: parsedName,
      tty: parsedTty,
    };

    this.propertiesCache.set(normalizedRxcui, result);
    return result;
  }

  private async tryResolveRxcuiInput(
    medication: string,
  ): Promise<RxNormNormalizationResult | null> {
    if (!RXCUI_INPUT_REGEX.test(medication)) {
      return null;
    }

    return this.resolveFinalConcept(medication, medication, "rxcui-input");
  }

  private async findByName(
    medication: string,
    strategy: Strategy,
    correctedInput?: string,
  ): Promise<RxNormNormalizationResult | null> {
    const response = await this.requestRxNorm("rxcui", {
      name: medication,
      allsrc: "0",
    });

    const root = this.unwrapRxNormRoot(response);
    const ids = asArray(
      pickPath<string | string[]>(root, ["idGroup", "rxnormId"]),
    )
      .map((value) => String(value))
      .filter((value) => RXCUI_INPUT_REGEX.test(value));

    if (ids.length === 0) {
      return null;
    }

    const primaryId = ids[0];
    if (!primaryId) {
      return null;
    }

    return this.resolveFinalConcept(
      medication,
      primaryId,
      strategy,
      correctedInput,
    );
  }

  private async findSpellingSuggestion(
    medication: string,
  ): Promise<string | null> {
    const response = await this.requestRxNorm("spellingsuggestions", {
      name: medication,
    });

    const root = this.unwrapRxNormRoot(response);

    const suggestions = asArray(
      pickPath<string | string[]>(root, [
        "suggestionGroup",
        "suggestionList",
        "suggestion",
      ]),
    )
      .map((value) => String(value))
      .map((value) => normalizeWhitespace(value))
      .filter((value) => value.length > 0);

    return suggestions[0] ?? null;
  }

  private async findApproximateMatch(
    medication: string,
  ): Promise<string | null> {
    const response = await this.requestRxNorm("approximateTerm", {
      term: medication,
      maxEntries: "1",
      option: "1",
    });

    const root = this.unwrapRxNormRoot(response);

    const firstCandidate = asArray(
      pickPath<Record<string, unknown> | Record<string, unknown>[]>(root, [
        "approximateGroup",
        "candidate",
      ]),
    )[0];

    const candidateRxcui = firstCandidate?.["rxcui"];
    if (typeof candidateRxcui !== "string") {
      return null;
    }

    return candidateRxcui;
  }

  private async resolveFinalConcept(
    input: string,
    baseRxcui: string,
    strategy: Strategy,
    correctedInput?: string,
  ): Promise<RxNormNormalizationResult> {
    const initialProperties = await this.getConceptProperties(baseRxcui);
    const generic = await this.getGenericForRxcui(baseRxcui);

    const target = generic ?? initialProperties;

    return {
      input,
      correctedInput,
      normalizedName: target.name,
      rxcui: target.rxcui,
      tty: target.tty,
      strategy,
      genericMapped: generic !== null,
    };
  }

  private async getGenericForRxcui(
    rxcui: string,
  ): Promise<RxNormConceptProperties | null> {
    const response = await this.requestRxNorm(`rxcui/${rxcui}/generic`, {});
    const root = this.unwrapRxNormRoot(response);

    const concepts = asArray(
      pickPath<Record<string, unknown> | Record<string, unknown>[]>(root, [
        "minConceptGroup",
        "minConcept",
      ]),
    );

    if (concepts.length === 0) {
      return null;
    }

    const preferred = concepts.find((concept) => {
      const ttyValue = concept["tty"];
      const tty = typeof ttyValue === "string" ? ttyValue : "";
      return tty === "IN" || tty === "PIN";
    });

    const selected = preferred ?? concepts[0];
    if (!selected) {
      return null;
    }

    if (
      typeof selected["rxcui"] !== "string" ||
      typeof selected["name"] !== "string" ||
      typeof selected["tty"] !== "string"
    ) {
      return null;
    }

    return {
      rxcui: selected["rxcui"],
      name: selected["name"],
      tty: selected["tty"],
    };
  }

  private async requestRxNorm(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.requestWithFormat(endpoint, params, "json");
    } catch (error) {
      this.config.logger.warn(
        "RxNorm JSON request failed, trying XML fallback",
        {
          endpoint,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      return this.requestWithFormat(endpoint, params, "xml");
    }
  }

  private async requestWithFormat(
    endpoint: string,
    params: Record<string, string>,
    format: "json" | "xml",
  ): Promise<Record<string, unknown>> {
    const url = new URL(
      `${this.config.baseUrl.replace(/\/$/, "")}/${endpoint}.${format}`,
    );

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: format === "json" ? "application/json" : "application/xml",
        },
      });

      if (!response.ok) {
        throw new AppError(
          `RxNorm request failed: ${response.status} ${response.statusText}`,
          "RXNORM_API_ERROR",
          { endpoint, status: response.status },
        );
      }

      const body = await response.text();
      const parsed = this.parsePayload(body);
      if (!parsed) {
        throw new AppError(
          "RxNorm response parsing failed.",
          "RXNORM_PARSE_ERROR",
          {
            endpoint,
            format,
          },
        );
      }

      return parsed;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("RxNorm request timed out.", "RXNORM_TIMEOUT", {
          endpoint,
          timeoutMs: this.config.timeoutMs,
        });
      }

      throw new AppError("RxNorm request failed.", "RXNORM_API_ERROR", {
        endpoint,
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private parsePayload(body: string): Record<string, unknown> | null {
    const trimmed = body.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return JSON.parse(trimmed) as Record<string, unknown>;
    }

    if (trimmed.startsWith("<")) {
      return this.parser.parse(trimmed) as Record<string, unknown>;
    }

    return null;
  }

  private unwrapRxNormRoot(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const xmlRoot = asRecord(payload["rxnormdata"]);
    return xmlRoot ?? payload;
  }
}
