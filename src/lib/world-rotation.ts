/**
 * World design index for tournaments:
 * 1 & 2 => design 1, 3 & 4 => design 2, ...
 */
export function getWorldDesignNoForWeek(weekNumber: number): number {
  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    throw new Error('weekNumber must be an integer >= 1');
  }
  return Math.floor((weekNumber - 1) / 2) + 1;
}

/**
 * Deterministic seed mapping for world designs.
 * Design #1 intentionally remains seed 42 for compatibility.
 */
export function getWorldSeedForDesign(designNo: number): number {
  if (!Number.isInteger(designNo) || designNo < 1) {
    throw new Error('designNo must be an integer >= 1');
  }
  return 42 + ((designNo - 1) * 7919);
}
