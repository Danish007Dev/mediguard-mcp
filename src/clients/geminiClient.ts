import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";

interface GeminiClientConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  logger: Logger;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("Response is not an object.");
    }

    return parsed;
  } catch (error) {
    throw new AppError(
      "Gemini response is not valid JSON.",
      "GEMINI_PARSE_ERROR",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Gemini API wrapper for structured JSON generation with timeout/error mapping.
 */
export class GeminiClient {
  public constructor(private readonly config: GeminiClientConfig) {}

  public isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  public async generateStructuredJson(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<Record<string, unknown>> {
    if (!this.config.apiKey) {
      throw new AppError(
        "Gemini API key is not configured.",
        "GEMINI_NOT_CONFIGURED",
      );
    }

    const baseUrl = this.config.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/models/${encodeURIComponent(this.config.model)}:generateContent?key=${encodeURIComponent(
      this.config.apiKey,
    )}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `${systemPrompt}\n\n${userPrompt}`,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new AppError(
          `Gemini request failed: ${response.status} ${response.statusText}`,
          "GEMINI_API_ERROR",
          { status: response.status, body: body.slice(0, 500) },
        );
      }

      const payload = (await response.json()) as unknown;
      const candidates =
        isRecord(payload) && Array.isArray(payload["candidates"])
          ? payload["candidates"]
          : undefined;
      const firstCandidate = Array.isArray(candidates)
        ? candidates[0]
        : undefined;
      const content = isRecord(firstCandidate)
        ? firstCandidate["content"]
        : undefined;
      const parts =
        isRecord(content) && Array.isArray(content["parts"])
          ? content["parts"]
          : undefined;
      const firstPart = Array.isArray(parts) ? parts[0] : undefined;
      const text = isRecord(firstPart) ? firstPart["text"] : undefined;

      if (typeof text !== "string" || !text.trim()) {
        throw new AppError(
          "Gemini returned empty content.",
          "GEMINI_PARSE_ERROR",
        );
      }

      return parseJsonObject(text);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("Gemini request timed out.", "GEMINI_TIMEOUT", {
          timeoutMs: this.config.timeoutMs,
        });
      }

      throw new AppError("Gemini request failed.", "GEMINI_API_ERROR", {
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
