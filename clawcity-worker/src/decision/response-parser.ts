import { Decision } from './rule-engine';
import { ACTION_NAMES } from '../lib/tool-registry';
import { logger } from '../monitoring/logger';

const VALID_DIRECTIONS = ['north', 'south', 'east', 'west'];

/**
 * Parse and validate LLM JSON output into a Decision.
 * Returns null if the response is invalid.
 */
export function parseDecision(raw: string): Decision | null {
  try {
    // Strip markdown fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    const parsed = JSON.parse(cleaned);

    if (!parsed.action || !ACTION_NAMES.includes(parsed.action)) {
      logger.warn('Invalid action in LLM response', { action: parsed.action });
      return null;
    }

    const decision: Decision = {
      action: parsed.action,
      reasoning: parsed.reasoning || 'No reasoning provided',
    };

    switch (parsed.action) {
      case 'move':
        if (!parsed.direction || !VALID_DIRECTIONS.includes(parsed.direction)) {
          decision.direction = VALID_DIRECTIONS[Math.floor(Math.random() * 4)];
        } else {
          decision.direction = parsed.direction;
        }
        break;

      case 'speak':
        decision.message = parsed.message;
        decision.to = parsed.to;
        break;

      case 'trade_propose':
        decision.target = parsed.target;
        decision.offer = parsed.offer;
        decision.request = parsed.request;
        break;

      case 'trade_accept':
      case 'trade_reject':
        decision.trade_id = parsed.trade_id;
        break;

      case 'build':
        decision.building_type = parsed.building_type;
        break;

      case 'craft':
        decision.item_id = parsed.item_id;
        break;

      case 'buy':
        decision.item_id = parsed.item_id;
        decision.quantity = parsed.quantity;
        break;

      case 'market_create':
        decision.offer_resource = parsed.offer_resource;
        decision.offer_amount = parsed.offer_amount;
        decision.request_resource = parsed.request_resource;
        decision.request_amount = parsed.request_amount;
        break;

      case 'market_fill':
        decision.order_id = parsed.order_id;
        decision.amount = parsed.amount;
        break;

      case 'market_cancel':
        decision.order_id = parsed.order_id;
        break;

      case 'forum_post':
        decision.thread_id = parsed.thread_id;
        decision.body = parsed.body;
        break;

      case 'forum_create_thread':
        decision.title = parsed.title;
        decision.body = parsed.body;
        decision.category = parsed.category;
        break;
    }

    return decision;
  } catch (err) {
    logger.error('Failed to parse LLM response', { raw, error: String(err) });
    return null;
  }
}
