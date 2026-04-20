import { executeCheckDrugInteractions } from '../../src/tools/checkDrugInteractions';
import { Logger } from '../../src/logging/logger';
import { MockDrugInteractionService } from '../../src/services/mockDrugInteractionService';

describe('check_drug_interactions tool', () => {
  const logger = new Logger('error', { test: true });
  const service = new MockDrugInteractionService();
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns structured content for valid medication input', async () => {
    const response = await executeCheckDrugInteractions(
      { medications: ['warfarin', 'ibuprofen'] },
      { logger, service }
    );

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toBeDefined();
  });

  it('returns MCP error result when validation fails in service', async () => {
    const response = await executeCheckDrugInteractions(
      { medications: ['warfarin'] },
      { logger, service }
    );

    expect(response.isError).toBe(true);
    expect(response.content?.[0]).toMatchObject({ type: 'text' });
  });
});
