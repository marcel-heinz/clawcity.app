import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function registerScanCommands(program: Command) {
  program
    .command('scan [terrain]')
    .description('Find nearest harvestable non-depleted tile near your current position')
    .option('-r, --radius <n>', 'Scan radius in tiles (max 50, spyglass extends cap)', '50')
    .option('--json', 'Print raw JSON response')
    .action(async (terrain: string | undefined, opts: { radius: string; json?: boolean }) => {
      const body: Record<string, unknown> = {};
      const parsedRadius = parseInt(opts.radius, 10);
      if (Number.isFinite(parsedRadius)) {
        body.radius = parsedRadius;
      }
      if (terrain) {
        body.terrain = terrain.toLowerCase();
      }

      const res = await api('/api/actions/scan', { method: 'POST', body });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }

      const data = res.data as Record<string, unknown>;
      const found = data.found === true;
      const scan = asRecord(data.scan);
      const usedSpyglass = scan?.used_spyglass === true;
      const target = asRecord(data.target);

      if (!found || !target) {
        const message = asString(data.message) || 'No harvestable tile found in range.';
        const effectiveRadius = asNumber(scan?.effective_radius);
        const maxRadius = asNumber(scan?.max_radius);
        if (effectiveRadius !== null && maxRadius !== null && effectiveRadius < maxRadius) {
          console.log(`${message} (scan capped at ${effectiveRadius}/${maxRadius}).`);
          return;
        }
        console.log(message);
        return;
      }

      const terrainLabel = asString(target.terrain) || 'unknown';
      const x = asNumber(target.x);
      const y = asNumber(target.y);
      const distance = asNumber(target.distance);
      const effectiveRadius = asNumber(scan?.effective_radius);
      const maxRadius = asNumber(scan?.max_radius);
      const depleted = asNumber(scan?.depleted_tiles);

      const pieces = [
        `Next fresh ${terrainLabel} tile: (${x ?? '?'},${y ?? '?'})`,
        `distance:${distance ?? '?'}`,
      ];
      if (effectiveRadius !== null) {
        pieces.push(`radius:${effectiveRadius}`);
      }
      if (maxRadius !== null && effectiveRadius !== null && effectiveRadius < maxRadius) {
        pieces.push(`capped:${effectiveRadius}/${maxRadius}`);
      }
      if (depleted !== null) {
        pieces.push(`depleted_seen:${depleted}`);
      }
      if (usedSpyglass) {
        const usesRemaining = asNumber(scan?.spyglass_uses_remaining);
        if (usesRemaining !== null) {
          pieces.push(`spyglass_uses:${usesRemaining}`);
        } else {
          pieces.push('spyglass_used');
        }
      }

      console.log(pieces.join(' | '));
    });
}
