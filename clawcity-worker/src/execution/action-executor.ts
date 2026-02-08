import { Decision } from '../decision/rule-engine';
import { apiRequest } from './api-client';
import { logger } from '../monitoring/logger';

export interface ExecutionResult {
  success: boolean;
  error?: string;
}

/**
 * Execute a decision by calling the appropriate ClawCity API endpoint.
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
        return { success: !!result.success, error: result.error };
      }

      case 'gather': {
        const result = await apiRequest('/api/actions/gather', apiKey, {});
        return { success: !!result.success, error: result.error };
      }

      case 'claim': {
        const result = await apiRequest('/api/actions/claim', apiKey, {});
        return { success: !!result.success, error: result.error };
      }

      case 'upgrade': {
        const result = await apiRequest('/api/actions/upgrade', apiKey, {});
        return { success: !!result.success, error: result.error };
      }

      case 'build': {
        if (!decision.building_type) {
          return { success: false, error: 'No building_type specified' };
        }
        const result = await apiRequest('/api/actions/build', apiKey, {
          building_type: decision.building_type,
        });
        return { success: !!result.success, error: result.error };
      }

      case 'demolish': {
        const result = await apiRequest('/api/actions/demolish', apiKey, {});
        return { success: !!result.success, error: result.error };
      }

      case 'craft': {
        if (!decision.item_id) {
          return { success: false, error: 'No item_id specified for craft' };
        }
        const result = await apiRequest('/api/actions/craft', apiKey, {
          item_id: decision.item_id,
        });
        return { success: !!result.success, error: result.error };
      }

      case 'buy': {
        if (!decision.item_id) {
          return { success: false, error: 'No item_id specified for buy' };
        }
        const body: Record<string, unknown> = { item_id: decision.item_id };
        if (decision.quantity) body.quantity = decision.quantity;
        const result = await apiRequest('/api/actions/buy', apiKey, body);
        return { success: !!result.success, error: result.error };
      }

      case 'speak': {
        const result = await apiRequest('/api/actions/speak', apiKey, {
          message: decision.message || decision.reasoning?.slice(0, 200) || 'Hello!',
          ...(decision.to && { to: decision.to }),
        });
        return { success: !!result.success, error: result.error };
      }

      case 'trade_propose': {
        if (!decision.target || !decision.offer || !decision.request) {
          return { success: false, error: 'Missing target/offer/request for trade_propose' };
        }
        const result = await apiRequest('/api/actions/trade', apiKey, {
          target: decision.target,
          offer: decision.offer,
          request: decision.request,
        });
        return { success: !!result.success, error: result.error };
      }

      case 'trade_accept': {
        if (!decision.trade_id) {
          return { success: false, error: 'No trade_id for trade_accept' };
        }
        const result = await apiRequest('/api/actions/trade', apiKey, {
          action: 'accept',
          trade_id: decision.trade_id,
        });
        return { success: !!result.success, error: result.error };
      }

      case 'trade_reject': {
        if (!decision.trade_id) {
          return { success: false, error: 'No trade_id for trade_reject' };
        }
        const result = await apiRequest('/api/actions/trade', apiKey, {
          action: 'reject',
          trade_id: decision.trade_id,
        });
        return { success: !!result.success, error: result.error };
      }

      case 'market_create': {
        if (!decision.offer_resource || !decision.offer_amount || !decision.request_resource || !decision.request_amount) {
          return { success: false, error: 'Missing params for market_create' };
        }
        const result = await apiRequest('/api/market/orders', apiKey, {
          offer_resource: decision.offer_resource,
          offer_amount: decision.offer_amount,
          request_resource: decision.request_resource,
          request_amount: decision.request_amount,
        });
        return { success: !!result.success, error: result.error };
      }

      case 'market_fill': {
        if (!decision.order_id) {
          return { success: false, error: 'No order_id for market_fill' };
        }
        const body: Record<string, unknown> = { order_id: decision.order_id };
        if (decision.amount) body.amount = decision.amount;
        const result = await apiRequest('/api/market/orders/fill', apiKey, body);
        return { success: !!result.success, error: result.error };
      }

      case 'market_cancel': {
        if (!decision.order_id) {
          return { success: false, error: 'No order_id for market_cancel' };
        }
        const result = await apiRequest(
          `/api/market/orders/${decision.order_id}`,
          apiKey,
          undefined,
          'DELETE'
        );
        return { success: !!result.success, error: result.error };
      }

      case 'forum_post': {
        if (!decision.thread_id || !decision.body) {
          return { success: false, error: 'Missing thread_id/body for forum_post' };
        }
        const result = await apiRequest('/api/forum/posts', apiKey, {
          thread_id: decision.thread_id,
          body: decision.body,
        });
        return { success: !!result.success, error: result.error };
      }

      case 'forum_create_thread': {
        if (!decision.title || !decision.body) {
          return { success: false, error: 'Missing title/body for forum_create_thread' };
        }
        const body: Record<string, unknown> = {
          title: decision.title,
          body: decision.body,
        };
        if (decision.category) body.category = decision.category;
        const result = await apiRequest('/api/forum/threads', apiKey, body);
        return { success: !!result.success, error: result.error };
      }

      case 'tournament_join': {
        const result = await apiRequest('/api/tournaments/join', apiKey, {});
        return { success: !!result.success, error: result.error };
      }

      default:
        return { success: false, error: `Unknown action: ${decision.action}` };
    }
  } catch (error) {
    logger.error('Action execution error', { action: decision.action, error: String(error) });
    return { success: false, error: String(error) };
  }
}
