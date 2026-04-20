import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import { TtlCache } from "../utils/ttlCache";

interface OpenFdaClientConfig {
  baseUrl: string;
  timeoutMs: number;
  cacheTtlMs: number;
  logger: Logger;
}

export interface OpenFdaLabelData {
  queriedDrugName: string;
  setId?: string;
  interactionText: string[];
  warningText: string[];
  aliases: string[];
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => normalizeWhitespace(entry))
    .filter((entry) => entry.length > 0);
}

/**
 * OpenFDA label client with TTL caching and normalized interaction extraction.
 */
export class OpenFdaClient {
  private readonly labelCache: TtlCache<string, OpenFdaLabelData | null>;

  public constructor(private readonly config: OpenFdaClientConfig) {
    this.labelCache = new TtlCache(config.cacheTtlMs);
  }

  public async getDrugLabelInteractions(
    drugName: string,
  ): Promise<OpenFdaLabelData | null> {
    const normalizedDrugName = normalizeWhitespace(drugName).toLowerCase();
    if (!normalizedDrugName) {
      throw new AppError(
        "Drug name cannot be empty for OpenFDA lookup.",
        "VALIDATION_ERROR",
      );
    }

    const cached = this.labelCache.get(normalizedDrugName);
    if (cached !== undefined) {
      return cached;
    }

    const url = new URL(
      `${this.config.baseUrl.replace(/\/$/, "")}/drug/label.json`,
    );

    url.searchParams.set(
      "search",
      `(openfda.brand_name:"${normalizedDrugName}"+OR+openfda.generic_name:"${normalizedDrugName}")`,
    );
    url.searchParams.set("limit", "1");

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      if (response.status === 404) {
        this.labelCache.set(normalizedDrugName, null);
        return null;
      }

      if (!response.ok) {
        throw new AppError(
          `OpenFDA request failed: ${response.status} ${response.statusText}`,
          "OPENFDA_API_ERROR",
          { status: response.status, drugName: normalizedDrugName },
        );
      }

      const payload = (await response.json()) as unknown;
      const parsed = this.parseLabelPayload(payload, normalizedDrugName);
      this.labelCache.set(normalizedDrugName, parsed);
      return parsed;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("OpenFDA request timed out.", "OPENFDA_TIMEOUT", {
          drugName: normalizedDrugName,
          timeoutMs: this.config.timeoutMs,
        });
      }

      throw new AppError("OpenFDA request failed.", "OPENFDA_API_ERROR", {
        drugName: normalizedDrugName,
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseLabelPayload(
    payload: unknown,
    drugName: string,
  ): OpenFdaLabelData | null {
    const results = isRecord(payload) ? payload["results"] : undefined;

    if (!Array.isArray(results) || results.length === 0) {
      return null;
    }

    const result = results[0];
    if (!isRecord(result)) {
      return null;
    }

    const interactionText = toStringArray(result["drug_interactions"]);
    const warningText = toStringArray(result["warnings_and_cautions"]);

    const openFdaRaw = result["openfda"];
    const openFdaData = isRecord(openFdaRaw) ? openFdaRaw : undefined;
    const genericAliases = toStringArray(openFdaData?.["generic_name"]);
    const brandAliases = toStringArray(openFdaData?.["brand_name"]);

    const setIdValue = result["set_id"];
    const setId = typeof setIdValue === "string" ? setIdValue : undefined;

    return {
      queriedDrugName: drugName,
      setId,
      interactionText,
      warningText,
      aliases: Array.from(
        new Set([...genericAliases, ...brandAliases, drugName]),
      ),
    };
  }
}
