import { getDepletionChance } from './types';

export type TileHealth =
  | 'non_depleting'
  | 'depleted'
  | 'fresh'
  | 'stable'
  | 'fragile'
  | 'critical';

export interface GatherCooldownMeta {
  cooldown_ms: number;
  cooldown_remaining_ms: number;
  next_gather_at: string;
}

export interface GatherTileIntel {
  model: 'depleting' | 'non_depleting';
  gather_count: number;
  tile_health: TileHealth;
  depletion_chance_percent: number;
  gathers_remaining_estimate: number | null;
}

export type HarvestRiskBand = 'none' | 'low' | 'moderate' | 'high' | 'blocked';

export type IntelConfidenceLevel = 'high' | 'medium' | 'low';

export interface ScanTileIntel extends GatherTileIntel {
  harvestable: boolean;
  harvest_risk: HarvestRiskBand;
  observed_at: string;
  staleness_ms: number;
  confidence: {
    level: IntelConfidenceLevel;
    score: number;
  };
}

export interface ScanMetadata {
  schema_version: 'scan.v2';
  observed_at: string;
  generated_at: string;
  staleness_ms: number;
  confidence: {
    level: IntelConfidenceLevel;
    score: number;
  };
}

function clampMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function confidenceLevel(score: number): IntelConfidenceLevel {
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

export function buildGatherCooldownMeta(
  cooldownMs: number,
  remainingMs: number,
  nowMs: number = Date.now(),
): GatherCooldownMeta {
  const normalizedCooldown = clampMs(cooldownMs);
  const normalizedRemaining = Math.min(normalizedCooldown, clampMs(remainingMs));

  return {
    cooldown_ms: normalizedCooldown,
    cooldown_remaining_ms: normalizedRemaining,
    next_gather_at: new Date(nowMs + normalizedRemaining).toISOString(),
  };
}

export function classifyTileHealth(
  depletionChancePercent: number,
  opts: { depleted?: boolean; nonDepleting?: boolean } = {},
): TileHealth {
  if (opts.nonDepleting) return 'non_depleting';
  if (opts.depleted) return 'depleted';

  if (depletionChancePercent <= 0) return 'fresh';
  if (depletionChancePercent <= 18) return 'stable';
  if (depletionChancePercent <= 35) return 'fragile';
  return 'critical';
}

export function estimateGathersRemaining(currentGatherCount: number, maxSteps: number = 64): number {
  const baseCount = Math.max(0, Math.floor(currentGatherCount));
  let survivalProbability = 1;
  let expectedRemaining = 0;

  for (let step = 1; step <= maxSteps; step += 1) {
    expectedRemaining += survivalProbability;

    const depletionChance = getDepletionChance(baseCount + step);
    survivalProbability *= Math.max(0, 1 - depletionChance);

    if (survivalProbability < 0.001) {
      break;
    }
  }

  return Math.max(0, Math.round(expectedRemaining));
}

export function buildGatherTileIntel(
  gatherCount: number,
  opts: { depleted?: boolean; nonDepleting?: boolean } = {},
): GatherTileIntel {
  const normalizedCount = Math.max(0, Math.floor(gatherCount));

  if (opts.nonDepleting) {
    return {
      model: 'non_depleting',
      gather_count: normalizedCount,
      tile_health: 'non_depleting',
      depletion_chance_percent: 0,
      gathers_remaining_estimate: null,
    };
  }

  if (opts.depleted) {
    return {
      model: 'depleting',
      gather_count: normalizedCount,
      tile_health: 'depleted',
      depletion_chance_percent: 100,
      gathers_remaining_estimate: 0,
    };
  }

  const nextGatherChancePercent = Math.round(getDepletionChance(normalizedCount + 1) * 100);

  return {
    model: 'depleting',
    gather_count: normalizedCount,
    tile_health: classifyTileHealth(nextGatherChancePercent),
    depletion_chance_percent: nextGatherChancePercent,
    gathers_remaining_estimate: estimateGathersRemaining(normalizedCount),
  };
}

export function classifyHarvestRisk(
  tileIntel: GatherTileIntel,
  opts: { harvestable?: boolean } = {},
): HarvestRiskBand {
  if (opts.harvestable === false || tileIntel.tile_health === 'depleted') {
    return 'blocked';
  }
  if (tileIntel.tile_health === 'non_depleting') {
    return 'none';
  }
  if (tileIntel.depletion_chance_percent <= 10) return 'low';
  if (tileIntel.depletion_chance_percent <= 28) return 'moderate';
  return 'high';
}

export function buildScanTileIntel(params: {
  gatherCount: number;
  harvestable: boolean;
  nonDepleting?: boolean;
  observedAtMs: number;
  generatedAtMs?: number;
}): ScanTileIntel {
  const generatedAtMs = params.generatedAtMs ?? Date.now();
  const stalenessMs = clampMs(generatedAtMs - params.observedAtMs);
  const baseIntel = buildGatherTileIntel(params.gatherCount, {
    depleted: !params.harvestable,
    nonDepleting: params.nonDepleting,
  });

  let confidenceScore = 0.92;
  if (stalenessMs > 2_000) confidenceScore -= 0.1;
  if (stalenessMs > 10_000) confidenceScore -= 0.2;
  if (!params.harvestable) confidenceScore -= 0.05;

  const score = clampScore(confidenceScore);
  return {
    ...baseIntel,
    harvestable: params.harvestable,
    harvest_risk: classifyHarvestRisk(baseIntel, { harvestable: params.harvestable }),
    observed_at: new Date(params.observedAtMs).toISOString(),
    staleness_ms: stalenessMs,
    confidence: {
      level: confidenceLevel(score),
      score,
    },
  };
}

export function buildScanMetadata(params: {
  observedAtMs: number;
  generatedAtMs?: number;
  scannedTiles: number;
  harvestableTiles: number;
  depletedTiles: number;
  blockedByBuildings: number;
}): ScanMetadata {
  const generatedAtMs = params.generatedAtMs ?? Date.now();
  const stalenessMs = clampMs(generatedAtMs - params.observedAtMs);
  const scannedTiles = Math.max(0, Math.floor(params.scannedTiles));
  const penaltyRatio = scannedTiles > 0
    ? (Math.max(0, params.depletedTiles) + Math.max(0, params.blockedByBuildings)) / scannedTiles
    : 1;

  let confidenceScore = 0.9;
  if (stalenessMs > 2_000) confidenceScore -= 0.1;
  if (stalenessMs > 10_000) confidenceScore -= 0.2;
  if (scannedTiles < 25) confidenceScore -= 0.1;
  if (penaltyRatio > 0.8) confidenceScore -= 0.1;
  if (params.harvestableTiles === 0 && scannedTiles > 0) confidenceScore -= 0.05;

  const score = clampScore(confidenceScore);
  return {
    schema_version: 'scan.v2',
    observed_at: new Date(params.observedAtMs).toISOString(),
    generated_at: new Date(generatedAtMs).toISOString(),
    staleness_ms: stalenessMs,
    confidence: {
      level: confidenceLevel(score),
      score,
    },
  };
}
