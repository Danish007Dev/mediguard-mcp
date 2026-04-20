import { XMLParser } from "fast-xml-parser";
import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import { TtlCache } from "../utils/ttlCache";

interface DailyMedClientConfig {
  baseUrl: string;
  timeoutMs: number;
  cacheTtlMs: number;
  logger: Logger;
}

interface DailyMedSearchResult {
  setid: string;
  title?: string;
}

export interface DailyMedLabelSections {
  contraindications: string[];
  warnings: string[];
  pregnancy: string[];
  renal: string[];
  hepatic: string[];
}

export interface DailyMedLabelData {
  queriedDrugName: string;
  setId: string;
  title?: string;
  sections: DailyMedLabelSections;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

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

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

function flattenText(value: unknown): string {
  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  if (Array.isArray(value)) {
    return normalizeWhitespace(
      value.map((entry) => flattenText(entry)).join(" "),
    );
  }

  const record = asRecord(value);
  if (!record) {
    return "";
  }

  const parts: string[] = [];
  for (const [key, nested] of Object.entries(record)) {
    if (key.startsWith("@_")) {
      continue;
    }

    const text = flattenText(nested);
    if (text) {
      parts.push(text);
    }
  }

  return normalizeWhitespace(parts.join(" "));
}

function truncateText(value: string, maxLength = 500): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      output.push(cleaned);
    }
  }

  return output;
}

/**
 * DailyMed SPL client that resolves label sections used in contraindication analysis.
 */
export class DailyMedClient {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    parseTagValue: true,
  });

  private readonly labelCache: TtlCache<string, DailyMedLabelData | null>;

  public constructor(private readonly config: DailyMedClientConfig) {
    this.labelCache = new TtlCache(config.cacheTtlMs);
  }

  public async getDrugLabelSections(
    drugName: string,
  ): Promise<DailyMedLabelData | null> {
    const normalizedDrugName = normalizeWhitespace(drugName).toLowerCase();
    if (!normalizedDrugName) {
      throw new AppError(
        "Drug name cannot be empty for DailyMed lookup.",
        "VALIDATION_ERROR",
      );
    }

    const cached = this.labelCache.get(normalizedDrugName);
    if (cached !== undefined) {
      return cached;
    }

    const searchPayload = await this.requestJson("/services/v2/spls.json", {
      drug_name: normalizedDrugName,
      pagesize: "5",
    });

    const selected = this.selectBestResult(searchPayload, normalizedDrugName);
    if (!selected) {
      this.labelCache.set(normalizedDrugName, null);
      return null;
    }

    const xmlContent = await this.requestText(
      `/services/v2/spls/${selected.setid}.xml`,
    );

    let parsedXml: unknown;
    try {
      parsedXml = this.parser.parse(xmlContent);
    } catch (error) {
      throw new AppError(
        "Failed to parse DailyMed SPL XML.",
        "DAILYMED_PARSE_ERROR",
        {
          setId: selected.setid,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const sections = this.extractSections(parsedXml);
    const labelData: DailyMedLabelData = {
      queriedDrugName: normalizedDrugName,
      setId: selected.setid,
      title: selected.title,
      sections,
    };

    this.labelCache.set(normalizedDrugName, labelData);
    return labelData;
  }

  private selectBestResult(
    payload: unknown,
    normalizedDrugName: string,
  ): DailyMedSearchResult | null {
    const root = asRecord(payload);
    const entries = asArray(root?.["data"])
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry): DailyMedSearchResult | null => {
        const setid =
          typeof entry["setid"] === "string" ? entry["setid"] : undefined;
        const title =
          typeof entry["title"] === "string" ? entry["title"] : undefined;

        if (!setid) {
          return null;
        }

        return {
          setid,
          title,
        };
      })
      .filter(isNonNull);

    if (entries.length === 0) {
      return null;
    }

    const containsToken = (value: string, token: string): boolean => {
      const haystack = value.toLowerCase();
      return (
        haystack.includes(token) ||
        haystack.includes(token.replace(/\s+/g, "-"))
      );
    };

    const strictMatch = entries.find((entry) =>
      entry.title ? containsToken(entry.title, normalizedDrugName) : false,
    );

    return strictMatch ?? entries[0] ?? null;
  }

  private extractSections(parsedXml: unknown): DailyMedLabelSections {
    const sections: DailyMedLabelSections = {
      contraindications: [],
      warnings: [],
      pregnancy: [],
      renal: [],
      hepatic: [],
    };

    const walkSection = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const entry of node) {
          walkSection(entry);
        }
        return;
      }

      const record = asRecord(node);
      if (!record) {
        return;
      }

      const maybeSection = asRecord(record["section"]);
      if (maybeSection) {
        walkSection(maybeSection);
      }

      const titleRaw = flattenText(record["title"]);
      const textRaw = flattenText(record["text"]);

      if (titleRaw && textRaw) {
        const title = titleRaw.toLowerCase();
        const snippet = truncateText(textRaw);

        if (title.includes("contraindication")) {
          sections.contraindications.push(snippet);
        }

        if (title.includes("warning") || title.includes("boxed warning")) {
          sections.warnings.push(snippet);
        }

        if (title.includes("pregnancy")) {
          sections.pregnancy.push(snippet);
        }

        if (title.includes("renal") || title.includes("kidney")) {
          sections.renal.push(snippet);
        }

        if (title.includes("hepatic") || title.includes("liver")) {
          sections.hepatic.push(snippet);
        }
      }

      for (const value of Object.values(record)) {
        walkSection(value);
      }
    };

    walkSection(parsedXml);

    return {
      contraindications: uniqueStrings(sections.contraindications).slice(0, 4),
      warnings: uniqueStrings(sections.warnings).slice(0, 4),
      pregnancy: uniqueStrings(sections.pregnancy).slice(0, 3),
      renal: uniqueStrings(sections.renal).slice(0, 3),
      hepatic: uniqueStrings(sections.hepatic).slice(0, 3),
    };
  }

  private async requestJson(
    endpoint: string,
    query: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await this.request(endpoint, query, "application/json");

    try {
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      throw new AppError(
        "Failed to parse DailyMed JSON response.",
        "DAILYMED_PARSE_ERROR",
        {
          endpoint,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async requestText(endpoint: string): Promise<string> {
    const response = await this.request(endpoint, {}, "application/xml");
    return response.text();
  }

  private async request(
    endpoint: string,
    query: Record<string, string>,
    accept: string,
  ): Promise<Response> {
    const url = new URL(`${this.config.baseUrl.replace(/\/$/, "")}${endpoint}`);

    for (const [key, value] of Object.entries(query)) {
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
          Accept: accept,
        },
      });

      if (!response.ok) {
        throw new AppError(
          `DailyMed request failed: ${response.status} ${response.statusText}`,
          "DAILYMED_API_ERROR",
          { endpoint, status: response.status },
        );
      }

      return response;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("DailyMed request timed out.", "DAILYMED_TIMEOUT", {
          endpoint,
          timeoutMs: this.config.timeoutMs,
        });
      }

      throw new AppError("DailyMed request failed.", "DAILYMED_API_ERROR", {
        endpoint,
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
