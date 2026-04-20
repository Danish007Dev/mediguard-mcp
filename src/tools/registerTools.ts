import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { env } from "../config/env";
import type { Logger } from "../logging/logger";
import {
  checkDrugInteractionsInputSchema,
  checkDrugInteractionsOutputSchema,
  executeCheckDrugInteractions,
} from "./checkDrugInteractions";
import {
  analyzePolypharmacyInputSchema,
  analyzePolypharmacyOutputSchema,
  executeAnalyzePolypharmacy,
} from "./analyzePolypharmacy";
import {
  checkContraindicationsInputSchema,
  checkContraindicationsOutputSchema,
  executeCheckContraindications,
} from "./checkContraindications";
import {
  getSaferAlternativesInputSchema,
  getSaferAlternativesOutputSchema,
  executeGetSaferAlternatives,
} from "./getSaferAlternatives";
import {
  explainMedicationSafetyInputSchema,
  explainMedicationSafetyOutputSchema,
  executeExplainMedicationSafety,
} from "./explainMedicationSafety";
import { OpenFdaClient } from "../clients/openFdaClient";
import { RxNormClient } from "../clients/rxNormClient";
import { DailyMedClient } from "../clients/dailyMedClient";
import { FhirR4Client } from "../clients/fhirR4Client";
import { GroqClient } from "../clients/groqClient";
import { GeminiClient } from "../clients/geminiClient";
import { InteractionSynthesisService } from "../services/interactionSynthesisService";
import { PolypharmacySynthesisService } from "../services/polypharmacySynthesisService";
import { ContraindicationSynthesisService } from "../services/contraindicationSynthesisService";
import { SaferAlternativesSynthesisService } from "../services/saferAlternativesSynthesisService";
import { MedicationSafetyExplanationSynthesisService } from "../services/medicationSafetyExplanationSynthesisService";
import { RxNormOpenFdaDrugInteractionService } from "../services/rxNormOpenFdaDrugInteractionService";
import { PolypharmacyService } from "../services/polypharmacyService";
import { ContraindicationService } from "../services/contraindicationService";
import { SaferAlternativesService } from "../services/saferAlternativesService";
import { MedicationSafetyExplanationService } from "../services/medicationSafetyExplanationService";
import { SharpContextFhirService } from "../services/sharpContextFhirService";

/**
 * Wires all MediGuard tool handlers and their service dependencies into the MCP server.
 */
export function registerTools(server: McpServer, logger: Logger): void {
  const cacheTtlMs = env.DRUG_CACHE_TTL * 1000;

  const rxNormClient = new RxNormClient({
    baseUrl: env.RXNORM_API_URL,
    timeoutMs: env.API_TIMEOUT_MS,
    cacheTtlMs,
    logger: logger.child({ component: "rxnorm-client" }),
  });

  const openFdaClient = new OpenFdaClient({
    baseUrl: env.OPENFDA_API_URL,
    timeoutMs: env.API_TIMEOUT_MS,
    cacheTtlMs,
    logger: logger.child({ component: "openfda-client" }),
  });

  const dailyMedClient = new DailyMedClient({
    baseUrl: env.DAILYMED_API_URL,
    timeoutMs: env.API_TIMEOUT_MS,
    cacheTtlMs,
    logger: logger.child({ component: "dailymed-client" }),
  });

  const fhirClient = new FhirR4Client({
    timeoutMs: env.API_TIMEOUT_MS,
    pageSize: env.FHIR_PAGE_SIZE,
    maxPages: env.FHIR_MAX_PAGES,
    defaultTokenEndpoint: env.FHIR_DEFAULT_TOKEN_ENDPOINT,
    logger: logger.child({ component: "fhir-r4-client" }),
  });

  const sharpContextService = new SharpContextFhirService(
    fhirClient,
    logger.child({ component: "sharp-context-service" }),
  );

  const groqClient = new GroqClient({
    baseUrl: env.GROQ_API_URL,
    apiKey: env.GROQ_API_KEY,
    model: env.GROQ_MODEL,
    timeoutMs: env.API_TIMEOUT_MS,
    logger: logger.child({ component: "groq-client" }),
  });

  const geminiClient = new GeminiClient({
    baseUrl: env.GEMINI_API_URL,
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    timeoutMs: env.API_TIMEOUT_MS,
    logger: logger.child({ component: "gemini-client" }),
  });

  const synthesisService = new InteractionSynthesisService(
    groqClient,
    geminiClient,
    logger.child({ component: "interaction-synthesis" }),
  );

  const interactionService = new RxNormOpenFdaDrugInteractionService(
    rxNormClient,
    openFdaClient,
    logger.child({ component: "interaction-service" }),
    synthesisService,
  );

  const polypharmacySynthesisService = new PolypharmacySynthesisService(
    groqClient,
    geminiClient,
    logger.child({ component: "polypharmacy-synthesis" }),
  );

  const polypharmacyService = new PolypharmacyService(
    logger.child({ component: "polypharmacy-service" }),
    polypharmacySynthesisService,
  );

  const contraindicationSynthesisService = new ContraindicationSynthesisService(
    groqClient,
    geminiClient,
    logger.child({ component: "contraindication-synthesis" }),
  );

  const contraindicationService = new ContraindicationService(
    logger.child({ component: "contraindication-service" }),
    dailyMedClient,
    contraindicationSynthesisService,
  );

  const saferAlternativesSynthesisService =
    new SaferAlternativesSynthesisService(
      groqClient,
      geminiClient,
      logger.child({ component: "safer-alternatives-synthesis" }),
    );

  const saferAlternativesService = new SaferAlternativesService(
    logger.child({ component: "safer-alternatives-service" }),
    saferAlternativesSynthesisService,
  );

  const medicationExplanationSynthesisService =
    new MedicationSafetyExplanationSynthesisService(
      groqClient,
      geminiClient,
      logger.child({ component: "medication-explanation-synthesis" }),
    );

  const medicationExplanationService = new MedicationSafetyExplanationService(
    logger.child({ component: "medication-explanation-service" }),
    medicationExplanationSynthesisService,
  );

  server.registerTool(
    "check_drug_interactions",
    {
      title: "Check Drug Interactions",
      description:
        "Checks medication names for potential drug-drug interactions using RxNorm normalization and OpenFDA label interaction data. SHARP-compliant context propagation is supported via sharp_context.",
      inputSchema: checkDrugInteractionsInputSchema,
      outputSchema: checkDrugInteractionsOutputSchema,
      annotations: {
        title: "Medication Safety",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      executeCheckDrugInteractions(args, {
        service: interactionService,
        logger,
        sharpContextService,
      }),
  );

  server.registerTool(
    "analyze_polypharmacy",
    {
      title: "Analyze Polypharmacy",
      description:
        "Evaluates medication regimen risk using age-based Beers-style checks, duplicate therapeutic classes, drug burden scoring, and deprescribing opportunities. SHARP-compliant context propagation is supported via sharp_context.",
      inputSchema: analyzePolypharmacyInputSchema,
      outputSchema: analyzePolypharmacyOutputSchema,
      annotations: {
        title: "Medication Safety",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      executeAnalyzePolypharmacy(args, {
        service: polypharmacyService,
        logger,
        sharpContextService,
      }),
  );

  server.registerTool(
    "check_contraindications",
    {
      title: "Check Contraindications",
      description:
        "Evaluates a proposed medication against allergies, conditions, labs, and DailyMed label evidence for contraindications and major safety warnings. SHARP-compliant context propagation is supported via sharp_context.",
      inputSchema: checkContraindicationsInputSchema,
      outputSchema: checkContraindicationsOutputSchema,
      annotations: {
        title: "Medication Safety",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      executeCheckContraindications(args, {
        service: contraindicationService,
        logger,
        sharpContextService,
      }),
  );

  server.registerTool(
    "get_safer_alternatives",
    {
      title: "Get Safer Alternatives",
      description:
        "Ranks safer medication alternatives using therapeutic class mapping, patient-specific risk filters, and basic formulary preference scoring. SHARP-compliant context propagation is supported via sharp_context.",
      inputSchema: getSaferAlternativesInputSchema,
      outputSchema: getSaferAlternativesOutputSchema,
      annotations: {
        title: "Medication Safety",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      executeGetSaferAlternatives(args, {
        service: saferAlternativesService,
        logger,
        sharpContextService,
      }),
  );

  server.registerTool(
    "explain_medication_safety",
    {
      title: "Explain Medication Safety",
      description:
        "Generates patient-friendly or provider-facing safety explanations from structured risk findings and recommendations. SHARP-compliant context propagation is supported via sharp_context.",
      inputSchema: explainMedicationSafetyInputSchema,
      outputSchema: explainMedicationSafetyOutputSchema,
      annotations: {
        title: "Medication Safety",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      executeExplainMedicationSafety(args, {
        service: medicationExplanationService,
        logger,
        sharpContextService,
      }),
  );
}
