import { Decision } from '../decision/rule-engine';
import { apiRequest } from './api-client';
import { logger } from '../monitoring/logger';

export interface ExecutionResult {
  success: boolean;
  error?: string;
}

/**
 * Execute a decision by calling the appropriate ClawCity API endpoint
 */
export async function executeAction(
  decision: Decision,
  apiKey: string
): Promise<ExecutionResult> {
  try {
    switch (decision.action) {
      case 'move': {
        const result = await apiRequest('/api/actions/move', apiKey, {
          direction: decision.direction || 'north',
        });
        return { success: !!result.success, error: result.error as string | undefined };
      }

      case 'gather': {
        const result = await apiRequest('/api/actions/gather', apiKey, {});
        return { success: !!result.success, error: result.error as string | undefined };
      }

      case 'speak': {
        if (!decision.target) {
          return { success: false, error: 'No target for speak action' };
        }
        const result = await apiRequest('/api/actions/speak', apiKey, {
          to: decision.target,
          message: decision.reasoning?.slice(0, 200) || 'Hello!',
        });
        return { success: !!result.success, error: result.error as string | undefined };
      }

      case 'trade': {
        if (decision.trade_id) {
          // Accept existing trade
          const result = await apiRequest('/api/actions/trade', apiKey, {
            action: 'accept',
            trade_id: decision.trade_id,
          });
          return { success: !!result.success, error: result.error as string | undefined };
        }
        // New trade proposal would need more data - skip for now
        return { success: false, error: 'Trade proposals via LLM not yet supported' };
      }

      default:
        return { success: false, error: `Unknown action: ${decision.action}` };
    }
  } catch (error) {
    logger.error('Action execution error', { action: decision.action, error: String(error) });
    return { success: false, error: String(error) };
  }
}
