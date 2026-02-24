import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

async function runMoveTo(target: string, maxSteps: string, asJson?: boolean) {
  const body: Record<string, unknown> = { max_steps: parseInt(maxSteps, 10) };

  // Coordinates support: "350,265" or "350 265"
  const coordMatch = target.match(/^(\d+)[,\s]+(\d+)$/);
  if (coordMatch) {
    body.x = parseInt(coordMatch[1], 10);
    body.y = parseInt(coordMatch[2], 10);
  } else {
    body.terrain = target.toLowerCase();
  }

  const res = await api('/api/actions/move-to', { method: 'POST', body });
  if (!res.ok) handleError(res);

  const d = res.data as Record<string, unknown>;
  if (asJson) {
    console.log(JSON.stringify(d, null, 2));
    return;
  }
  if (d.error || d.success === false) {
    console.error(`Error: ${d.error || 'Move failed'}`);
    process.exit(1);
  }
  const pos = d.position as Record<string, unknown> | undefined;
  const steps = d.steps_taken ?? d.steps ?? '?';
  const terrain = d.terrain ?? target;
  const x = pos?.x ?? '?';
  const y = pos?.y ?? '?';
  console.log(`Moved to (${x},${y}) ${terrain} in ${steps} steps`);
}

export function registerMoveCommands(program: Command) {
  program
    .command('move <target>')
    .description('Pathfind to terrain type (forest, mountain, ...) or coordinates (x,y)')
    .option('-s, --max-steps <n>', 'Max steps (default 60, max 300)', '60')
    .option('--json', 'Print raw JSON response')
    .action(async (target: string, opts: { maxSteps: string; json?: boolean }) => {
      await runMoveTo(target, opts.maxSteps, opts.json);
    });

  // Compatibility alias for auto-mode command drift.
  program
    .command('move-to <target>')
    .description('Alias for "move" (pathfind to terrain or coordinates)')
    .option('-s, --max-steps <n>', 'Max steps (default 60, max 300)', '60')
    .option('--json', 'Print raw JSON response')
    .action(async (target: string, opts: { maxSteps: string; json?: boolean }) => {
      await runMoveTo(target, opts.maxSteps, opts.json);
    });

  program
    .command('step <direction>')
    .description('Move one tile: north | south | east | west')
    .option('--json', 'Print raw JSON response')
    .action(async (direction: string, opts: { json?: boolean }) => {
      const normalized = direction.toLowerCase();
      if (!['north', 'south', 'east', 'west'].includes(normalized)) {
        console.error('Error: direction must be one of north|south|east|west');
        process.exit(1);
      }

      const res = await api('/api/actions/move', {
        method: 'POST',
        body: { direction: normalized },
      });
      if (!res.ok) handleError(res);

      const d = res.data as Record<string, unknown>;
      if (opts.json) {
        console.log(JSON.stringify(d, null, 2));
        return;
      }
      const pos = d.position as Record<string, unknown> | undefined;
      const terrain = d.terrain ?? 'unknown';
      const x = pos?.x ?? '?';
      const y = pos?.y ?? '?';
      const message = d.message ? String(d.message) : `Stepped ${normalized}`;
      console.log(`${message} -> (${x},${y}) ${terrain}`);
    });
}
