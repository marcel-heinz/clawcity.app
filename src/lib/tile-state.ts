export interface TileDepletionState {
  depleted?: boolean | null;
  depleted_at?: string | null;
  regenerates_at?: string | null;
}

export function getTileRegenerationTimestamp(tile: TileDepletionState): string | null {
  if (typeof tile.regenerates_at === 'string' && tile.regenerates_at.length > 0) {
    return tile.regenerates_at;
  }
  if (typeof tile.depleted_at === 'string' && tile.depleted_at.length > 0) {
    return tile.depleted_at;
  }
  return null;
}

export function hasTileRegenerated(regeneratesAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!regeneratesAt) return true;
  const regenTime = Date.parse(regeneratesAt);
  if (!Number.isFinite(regenTime)) return true;
  return nowMs >= regenTime;
}

export function isTileDepletedNow(tile: TileDepletionState, nowMs = Date.now()): boolean {
  const markedDepleted = tile.depleted === true;
  const regenerationTimestamp = getTileRegenerationTimestamp(tile);

  if (!markedDepleted && !regenerationTimestamp) {
    return false;
  }

  return !hasTileRegenerated(regenerationTimestamp, nowMs);
}

export function isTileHarvestable(tile: TileDepletionState, nowMs = Date.now()): boolean {
  return !isTileDepletedNow(tile, nowMs);
}
