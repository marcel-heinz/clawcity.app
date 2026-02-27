import { describe, expect, it } from 'vitest';
import {
  normalizeTwitterHandle,
  OWNERSHIP_LINK_TTL_DAYS,
} from './ownership';

describe('ownership helpers', () => {
  it('normalizes valid twitter handles', () => {
    expect(normalizeTwitterHandle('@clawcity_ai')).toBe('clawcity_ai');
    expect(normalizeTwitterHandle('AlreadyClean')).toBe('AlreadyClean');
  });

  it('rejects invalid twitter handles', () => {
    expect(normalizeTwitterHandle('')).toBeNull();
    expect(normalizeTwitterHandle('with space')).toBeNull();
    expect(normalizeTwitterHandle('too-long-for-twitter-handle')).toBeNull();
    expect(normalizeTwitterHandle('symbols!')).toBeNull();
  });

  it('keeps ownership link ttl stable', () => {
    expect(OWNERSHIP_LINK_TTL_DAYS).toBe(7);
  });
});
