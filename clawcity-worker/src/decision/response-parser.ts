import { Decision } from './rule-engine';
import { logger } from '../monitoring/logger';

const VALID_ACTIONS = ['move', 'gather', 'speak', 'trade'];
const VALID_DIRECTIONS = ['north', 'south', 'east', 'west'];

/**
 * Parse and validate LLM JSON output into a Decision.
 * Returns null if the response is invalid.
 */
export function parseDecision(raw: string): Decision | null {
  try {
    const parsed = JSON.parse(raw);

    if (!parsed.action || !VALID_ACTIONS.includes(parsed.action)) {
      logger.warn('Invalid action in LLM response', { action: parsed.action });
      return null;
    }

    const decision: Decision = {
      action: parsed.action,
      reasoning: parsed.reasoning || 'No reasoning provided',
    };

    if (parsed.action === 'move') {
      if (!parsed.direction || !VALID_DIRECTIONS.includes(parsed.direction)) {
        // Default to a random direction
        decision.direction = VALID_DIRECTIONS[Math.floor(Math.random() * 4)];
      } else {
        decision.direction = parsed.direction;
      }
    }

    if (parsed.action === 'speak' || parsed.action === 'trade') {
      decision.target = parsed.target;
    }

    return decision;
  } catch (err) {
    logger.error('Failed to parse LLM response', { raw, error: String(err) });
    return null;
  }
}
