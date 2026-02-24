import { describe, expect, it } from 'vitest';
import { getDetectionRange, getHarvestScanRange, type AgentItem } from './crafting';

function makeItem(itemId: string, usesRemaining: number | null, quantity = 1): AgentItem {
  return {
    id: `${itemId}-id`,
    agent_id: 'agent-1',
    item_id: itemId,
    quantity,
    uses_remaining: usesRemaining,
    created_at: '2026-01-01T00:00:00.000Z',
    expires_at: null,
  };
}

describe('crafting item effect helpers', () => {
  it('uses short-range default when no scan item exists', () => {
    expect(getHarvestScanRange([])).toBe(15);
    expect(getDetectionRange([])).toBe(5);
  });

  it('extends detection and scan ranges with active spyglass', () => {
    const items = [makeItem('spyglass', 80)];

    expect(getDetectionRange(items)).toBe(10);
    expect(getHarvestScanRange(items)).toBe(50);
  });

  it('ignores spyglass with no uses left', () => {
    const items = [makeItem('spyglass', 0)];

    expect(getDetectionRange(items)).toBe(5);
    expect(getHarvestScanRange(items)).toBe(15);
  });
});
