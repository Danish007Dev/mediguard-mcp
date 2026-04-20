import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../logging/logger';
import {
  checkDrugInteractionsInputSchema,
  checkDrugInteractionsOutputSchema,
  executeCheckDrugInteractions
} from './checkDrugInteractions';
import { MockDrugInteractionService } from '../services/mockDrugInteractionService';

export function registerTools(server: McpServer, logger: Logger): void {
  const interactionService = new MockDrugInteractionService();

  server.registerTool(
    'check_drug_interactions',
    {
      title: 'Check Drug Interactions',
      description:
        'Checks an array of medication names for potential drug-drug interactions. Returns mock data for initial integration testing.',
      inputSchema: checkDrugInteractionsInputSchema,
      outputSchema: checkDrugInteractionsOutputSchema,
      annotations: {
        title: 'Medication Safety',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) =>
      executeCheckDrugInteractions(args, {
        service: interactionService,
        logger
      })
  );
}
