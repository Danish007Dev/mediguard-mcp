import "dotenv/config";
import { z } from "zod";

const optionalString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  MCP_SERVER_NAME: z.string().min(1).default("mediguard-mcp"),
  MCP_SERVER_VERSION: z.string().min(1).default("0.1.0"),
  RXNORM_API_URL: z.string().url().default("https://rxnav.nlm.nih.gov/REST"),
  OPENFDA_API_URL: z.string().url().default("https://api.fda.gov"),
  DAILYMED_API_URL: z
    .string()
    .url()
    .default("https://dailymed.nlm.nih.gov/dailymed"),
  PUBMED_API_URL: z
    .string()
    .url()
    .default("https://eutils.ncbi.nlm.nih.gov/entrez/eutils"),
  PUBMED_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  PUBMED_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(4),
  PUBMED_CONTACT_EMAIL: optionalString,
  PUBMED_API_KEY: optionalString,
  GROQ_API_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.string().min(1).default("llama-3.3-70b-versatile"),
  GEMINI_API_URL: z
    .string()
    .url()
    .default("https://generativelanguage.googleapis.com/v1beta"),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().min(1).default("gemini-1.5-flash"),
  FHIR_PAGE_SIZE: z.coerce.number().int().positive().default(50),
  FHIR_MAX_PAGES: z.coerce.number().int().positive().default(20),
  FHIR_DEFAULT_TOKEN_ENDPOINT: optionalString,
  API_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DRUG_CACHE_TTL: z.coerce.number().int().positive().default(86400),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.flatten().fieldErrors;
  throw new Error(
    `Invalid environment configuration: ${JSON.stringify(details)}`,
  );
}

export const env = parsed.data;
