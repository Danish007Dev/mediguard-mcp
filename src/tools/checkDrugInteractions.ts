import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toAppError } from '../errors/appError';
import type { Logger } from '../logging/logger';
import type { DrugInteractionService } from '../services/mockDrugInteractionService';
import type { CheckDrugInteractionsResult } from '../types/medicationSafety';

const severitySchema = z.enum(['minor', 'moderate', 'major', 'contraindicated']);
const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const checkDrugInteractionsInputSchema = {
  medications: z
    .array(z.string().trim().min(1, 'Medication names cannot be empty.'))
    .min(2, 'Provide at least two medications to check interactions.')
    .max(50, 'A maximum of 50 medications is supported per request.')
    .describe('Array of medication names to evaluate for interactions.')
};

export const checkDrugInteractionsOutputSchema = {
  requestId: z.string().uuid(),
  source: z.literal('mock'),
  riskLevel: riskLevelSchema,
  medications: z.array(z.string()),
  interactions: z.array(
    z.object({
      drugs: z.array(z.string()).min(2),
      severity: severitySchema,
      mechanism: z.string(),
      clinicalImpact: z.string(),
      recommendations: z.array(z.string()),
      evidence: z.string()
    })
  ),
  summary: z.string(),
  generatedAt: z.string()
};

const inputObjectSchema = z.object(checkDrugInteractionsInputSchema);
const outputObjectSchema = z.object(checkDrugInteractionsOutputSchema);

export type CheckDrugInteractionsInput = z.infer<typeof inputObjectSchema>;

interface CheckDrugInteractionsDependencies {
  service: DrugInteractionService;
  logger: Logger;
}

function buildResponseText(result: CheckDrugInteractionsResult): string {
  const header = `Risk level: ${result.riskLevel}`;

  if (result.interactions.length === 0) {
    return `${header}\n${result.summary}`;
  }

  const interactions = result.interactions
    .map((interaction, index) => {
      const pair = interaction.drugs.join(' + ');
      return `${index + 1}. ${pair} (${interaction.severity}) - ${interaction.clinicalImpact}`;
    })
    .join('\n');

  return `${header}\n${result.summary}\n${interactions}`;
}

export async function executeCheckDrugInteractions(
  args: CheckDrugInteractionsInput,
  dependencies: CheckDrugInteractionsDependencies
): Promise<CallToolResult> {
  const requestId = randomUUID();
  const toolLogger = dependencies.logger.child({
    tool: 'check_drug_interactions',
    requestId
  });

  try {
    const medications = args.medications.map((medication) => medication.trim());

    toolLogger.info('Running medication interaction check', {
      medicationCount: medications.length
    });

    const result = await dependencies.service.checkDrugInteractions(medications, requestId);
    const validatedResult = outputObjectSchema.parse(result);

    toolLogger.info('Medication interaction check completed', {
      interactionCount: validatedResult.interactions.length,
      riskLevel: validatedResult.riskLevel
    });

    return {
      content: [
        {
          type: 'text',
          text: buildResponseText(validatedResult)
        }
      ],
      structuredContent: validatedResult
    };
  } catch (error) {
    const appError = toAppError(error, 'Unable to evaluate medication interactions.');

    toolLogger.error('Medication interaction check failed', {
      code: appError.code,
      message: appError.message,
      details: appError.details
    });

    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error [${appError.code}]: ${appError.message}`
        }
      ]
    };
  }
}
