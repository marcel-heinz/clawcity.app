import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getInBandFailureMessage(data: UnknownRecord): string | null {
  const success = data.success;
  const error = asString(data.error);
  const message = asString(data.message);
  if (success === false) {
    return error || message || 'Move failed';
  }
  if (error) {
    return error;
  }
  return null;
}

function createMoveProgressReporter(target: string, maxSteps: number, asJson?: boolean): () => void {
  if (asJson) {
    return () => {};
  }

  const isInteractive = Boolean(process.stdin.isTTY && process.stderr.isTTY);
  if (!isInteractive) {
    process.stderr.write(`Moving to ${target} (max ${maxSteps} steps)...\n`);
    return () => {};
  }

  const startedAt = Date.now();
  const frames = ['-', '\\', '|', '/'];
  let frameIndex = 0;
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const frame = frames[frameIndex % frames.length];
    frameIndex += 1;
    process.stderr.write(`\r[${frame}] Moving to ${target} (max ${maxSteps}) | ${elapsed}s`);
  }, 120);

  return () => {
    clearInterval(timer);
    process.stderr.write('\r');
    process.stderr.write(' '.repeat(120));
    process.stderr.write('\r');
  };
}

async function runMoveTo(target: string, maxSteps: string, asJson?: boolean) {
  const parsedMaxSteps = parseInt(maxSteps, 10);
  if (!Number.isFinite(parsedMaxSteps) || parsedMaxSteps <= 0) {
    console.error('Error: --max-steps must be a positive integer');
    process.exit(1);
  }

  const body: Record<string, unknown> = { max_steps: parsedMaxSteps };

  // Coordinates support: "350,265" or "350 265"
  const coordMatch = target.match(/^(\d+)[,\s]+(\d+)$/);
  if (coordMatch) {
    body.x = parseInt(coordMatch[1], 10);
    body.y = parseInt(coordMatch[2], 10);
  } else {
    body.terrain = target.toLowerCase();
  }

  const stopProgress = createMoveProgressReporter(target, parsedMaxSteps, asJson);
  const res = await api('/api/actions/move-to', { method: 'POST', body });
  if (!res.ok) {
    stopProgress();
    handleError(res);
  }

  const d = res.data as UnknownRecord;
  const inBandFailure = getInBandFailureMessage(d);
  if (asJson) {
    console.log(JSON.stringify(d, null, 2));
    if (inBandFailure) {
      process.exit(1);
    }
    return;
  }
  stopProgress();
  if (inBandFailure) {
    console.error(`Error: ${inBandFailure}`);
    process.exit(1);
  }
  const pos = asRecord(d.position);
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

      const d = res.data as UnknownRecord;
      const inBandFailure = getInBandFailureMessage(d);
      if (opts.json) {
        console.log(JSON.stringify(d, null, 2));
        if (inBandFailure) {
          process.exit(1);
        }
        return;
      }
      if (inBandFailure) {
        console.error(`Error: ${inBandFailure}`);
        process.exit(1);
      }
      const pos = asRecord(d.position);
      const terrain = d.terrain ?? 'unknown';
      const x = pos?.x ?? '?';
      const y = pos?.y ?? '?';
      const message = d.message ? String(d.message) : `Stepped ${normalized}`;
      console.log(`${message} -> (${x},${y}) ${terrain}`);
    });
}
