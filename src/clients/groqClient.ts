import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";

interface GroqClientConfig {
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
    throw new AppError("Groq response is not valid JSON.", "GROQ_PARSE_ERROR", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Lightweight Groq API wrapper for structured JSON synthesis requests.
 */
export class GroqClient {
  public constructor(private readonly config: GroqClientConfig) {}

  public isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  public async generateStructuredJson(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<Record<string, unknown>> {
    if (!this.config.apiKey) {
      throw new AppError(
        "Groq API key is not configured.",
        "GROQ_NOT_CONFIGURED",
      );
    }

    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;

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
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new AppError(
          `Groq request failed: ${response.status} ${response.statusText}`,
          "GROQ_API_ERROR",
          { status: response.status, body: body.slice(0, 500) },
        );
      }

      const payload = (await response.json()) as unknown;
      const choices =
        isRecord(payload) && Array.isArray(payload["choices"])
          ? payload["choices"]
          : undefined;
      const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
      const message = isRecord(firstChoice)
        ? firstChoice["message"]
        : undefined;
      const content = isRecord(message) ? message["content"] : undefined;

      if (typeof content !== "string" || !content.trim()) {
        throw new AppError("Groq returned empty content.", "GROQ_PARSE_ERROR");
      }

      return parseJsonObject(content);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("Groq request timed out.", "GROQ_TIMEOUT", {
          timeoutMs: this.config.timeoutMs,
        });
      }

      throw new AppError("Groq request failed.", "GROQ_API_ERROR", {
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
