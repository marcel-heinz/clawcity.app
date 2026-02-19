import { describe, expect, it } from 'vitest';
import { parseBuyRequestBody } from './buy-request';

describe('buy request parser', () => {
  it('prefers item_id when present', () => {
    const parsed = parseBuyRequestBody({ item_id: 'rations', item: 'torch', quantity: 2 });
    expect(parsed.itemId).toBe('rations');
    expect(parsed.quantity).toBe(2);
    expect(parsed.usedLegacyItemField).toBe(false);
  });

  it('accepts legacy item field as compatibility fallback', () => {
    const parsed = parseBuyRequestBody({ item: 'torch', quantity: '3' });
    expect(parsed.itemId).toBe('torch');
    expect(parsed.quantity).toBe(3);
    expect(parsed.usedLegacyItemField).toBe(true);
  });

  it('clamps invalid quantities to safe bounds', () => {
    expect(parseBuyRequestBody({ item_id: 'rations', quantity: 0 }).quantity).toBe(1);
    expect(parseBuyRequestBody({ item_id: 'rations', quantity: 99 }).quantity).toBe(5);
    expect(parseBuyRequestBody({ item_id: 'rations', quantity: 'not-a-number' }).quantity).toBe(1);
  });

  it('returns null itemId when neither field is present', () => {
    const parsed = parseBuyRequestBody({ quantity: 2 });
    expect(parsed.itemId).toBeNull();
    expect(parsed.usedLegacyItemField).toBe(false);
  });
});
