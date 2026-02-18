import { describe, expect, it } from 'vitest';
import { getWorldDesignNoForWeek, getWorldSeedForDesign } from './world-rotation';

describe('world rotation math', () => {
  it('maps tournament weeks to world designs by pairs', () => {
    expect(getWorldDesignNoForWeek(1)).toBe(1);
    expect(getWorldDesignNoForWeek(2)).toBe(1);
    expect(getWorldDesignNoForWeek(3)).toBe(2);
    expect(getWorldDesignNoForWeek(4)).toBe(2);
    expect(getWorldDesignNoForWeek(5)).toBe(3);
    expect(getWorldDesignNoForWeek(6)).toBe(3);
  });

  it('uses deterministic seed progression per design', () => {
    expect(getWorldSeedForDesign(1)).toBe(42);
    expect(getWorldSeedForDesign(2)).toBe(7961);
    expect(getWorldSeedForDesign(3)).toBe(15880);
  });

  it('rejects invalid inputs', () => {
    expect(() => getWorldDesignNoForWeek(0)).toThrow();
    expect(() => getWorldSeedForDesign(0)).toThrow();
  });
});
