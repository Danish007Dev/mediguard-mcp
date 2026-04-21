import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type {
  PubMedInteractionEvidenceSummary,
  PubMedStudyReference,
} from "../types/medicationSafety";
import { TtlCache } from "../utils/ttlCache";

interface PubMedClientConfig {
  baseUrl: string;
  timeoutMs: number;
  cacheTtlMs: number;
  logger: Logger;
  maxRetries?: number;
  toolName?: string;
  contactEmail?: string;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => normalizeWhitespace(entry))
    .filter((entry) => entry.length > 0);
}

function evidenceLevelFromStudies(studies: PubMedStudyReference[]): "A" | "B" | "C" | "D" {
  const combined = studies
    .flatMap((study) => [study.title, study.journal])
    .join(" ")
    .toLowerCase();

  if (/(meta-analysis|systematic review|randomized|randomised|trial)/.test(combined)) {
    return "A";
  }

  if (/(cohort|prospective|retrospective)/.test(combined)) {
    return "B";
  }

  if (/(case-control|case report|case series)/.test(combined)) {
    return "C";
  }

  return "D";
}

function confidenceFromCount(studyCount: number): number {
  const base = 0.55;
  const scaled = base + Math.min(0.35, studyCount * 0.08);
  return Number(Math.min(0.95, scaled).toFixed(2));
}

function pairKey(drug1: string, drug2: string): string {
  return [normalizeWhitespace(drug1).toLowerCase(), normalizeWhitespace(drug2).toLowerCase()]
    .sort()
    .join("::");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Lightweight PubMed E-Utilities client for drug-pair evidence retrieval.
 */
export class PubMedClient {
  private readonly cache: TtlCache<string, PubMedInteractionEvidenceSummary | null>;
  private readonly maxRetries: number;
  private readonly toolName: string;
  private readonly contactEmail?: string;

  public constructor(private readonly config: PubMedClientConfig) {
    this.cache = new TtlCache(config.cacheTtlMs);
    this.maxRetries = Math.max(0, config.maxRetries ?? 2);
    this.toolName =
      normalizeWhitespace(config.toolName ?? "mediguard-mcp") ||
      "mediguard-mcp";
    this.contactEmail = config.contactEmail
      ? normalizeWhitespace(config.contactEmail)
      : undefined;
  }

  public async getInteractionEvidence(
    drug1: string,
    drug2: string,
  ): Promise<PubMedInteractionEvidenceSummary | null> {
    const left = normalizeWhitespace(drug1);
    const right = normalizeWhitespace(drug2);

    if (!left || !right) {
      throw new AppError(
        "Drug names are required for PubMed evidence lookup.",
        "VALIDATION_ERROR",
      );
    }

    const cacheKey = pairKey(left, right);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const pmids = await this.searchPmids(left, right);
    if (pmids.length === 0) {
      this.cache.set(cacheKey, null);
      return null;
    }

    const studies = await this.fetchStudySummaries(pmids);
    if (studies.length === 0) {
      this.cache.set(cacheKey, null);
      return null;
    }

    const evidenceLevel = evidenceLevelFromStudies(studies);
    const confidence = confidenceFromCount(studies.length);

    const result: PubMedInteractionEvidenceSummary = {
      drug1: left,
      drug2: right,
      evidenceLevel,
      studyCount: studies.length,
      confidence,
      studies,
      synthesis:
        `Found ${studies.length} PubMed study summary record(s) for ${left} + ${right}. ` +
        `Highest inferred evidence level: ${evidenceLevel}. Confidence: ${(confidence * 100).toFixed(0)}%.`,
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  private async searchPmids(drug1: string, drug2: string): Promise<string[]> {
    const term = `${drug1} AND ${drug2} AND (interaction OR adverse OR toxicity OR bleeding)`;

    const payload = await this.request("esearch.fcgi", {
      db: "pubmed",
      term,
      retmode: "json",
      retmax: "5",
      sort: "relevance",
    });

    const searchResult = isRecord(payload) ? payload["esearchresult"] : undefined;
    const idList = isRecord(searchResult) ? searchResult["idlist"] : undefined;

    return asStringArray(idList);
  }

  private async fetchStudySummaries(pmids: string[]): Promise<PubMedStudyReference[]> {
    const payload = await this.request("esummary.fcgi", {
      db: "pubmed",
      id: pmids.join(","),
      retmode: "json",
    });

    const result = isRecord(payload) ? payload["result"] : undefined;
    if (!isRecord(result)) {
      return [];
    }

    const uids = asStringArray(result["uids"]);
    const studies: PubMedStudyReference[] = [];

    for (const uid of uids) {
      const entry = result[uid];
      if (!isRecord(entry)) {
        continue;
      }

      const title = asString(entry["title"]);
      if (!title) {
        continue;
      }

      const journal =
        asString(entry["fulljournalname"]) ??
        asString(entry["source"]) ??
        "Unknown journal";
      const published = asString(entry["pubdate"]) ?? "Unknown date";

      studies.push({
        pmid: uid,
        title,
        journal,
        published,
        link: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      });
    }

    return studies;
  }

  private async request(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const url = new URL(
        `${this.config.baseUrl.replace(/\/$/, "")}/${endpoint}`,
      );

      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      url.searchParams.set("tool", this.toolName);
      if (this.contactEmail) {
        url.searchParams.set("email", this.contactEmail);
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
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          if (
            shouldRetryStatus(response.status) &&
            attempt < this.maxRetries
          ) {
            const delayMs = 150 * 2 ** attempt;
            this.config.logger.warn(
              "Transient PubMed response status. Retrying request.",
              {
                endpoint,
                status: response.status,
                attempt: attempt + 1,
                nextDelayMs: delayMs,
              },
            );
            await sleep(delayMs);
            continue;
          }

          throw new AppError(
            `PubMed request failed: ${response.status} ${response.statusText}`,
            "PUBMED_API_ERROR",
            {
              status: response.status,
              endpoint,
              attempt: attempt + 1,
            },
          );
        }

        const payload = (await response.json()) as unknown;
        if (!isRecord(payload)) {
          throw new AppError(
            "PubMed response was not an object.",
            "PUBMED_PARSE_ERROR",
            {
              endpoint,
              attempt: attempt + 1,
            },
          );
        }

        return payload;
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        const isTransientNetwork =
          error instanceof Error &&
          /(fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|network)/i.test(
            error.message,
          );

        if ((isAbort || isTransientNetwork) && attempt < this.maxRetries) {
          const delayMs = 150 * 2 ** attempt;
          this.config.logger.warn(
            "Transient PubMed request error. Retrying request.",
            {
              endpoint,
              attempt: attempt + 1,
              nextDelayMs: delayMs,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          await sleep(delayMs);
          continue;
        }

        if (error instanceof AppError) {
          throw error;
        }

        if (isAbort) {
          throw new AppError("PubMed request timed out.", "PUBMED_TIMEOUT", {
            endpoint,
            timeoutMs: this.config.timeoutMs,
            attempt: attempt + 1,
          });
        }

        this.config.logger.warn("PubMed request failed", {
          endpoint,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });

        throw new AppError("PubMed request failed.", "PUBMED_API_ERROR", {
          endpoint,
          cause: error instanceof Error ? error.message : String(error),
          attempt: attempt + 1,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new AppError("PubMed request exhausted retries.", "PUBMED_API_ERROR", {
      endpoint,
      retries: this.maxRetries,
    });
  }
}
