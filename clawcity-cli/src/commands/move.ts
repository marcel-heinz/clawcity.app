import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerMoveCommands(program: Command) {
  program
    .command('move <target>')
    .description('Pathfind to terrain type (forest, mountain, ...) or coordinates (x,y)')
    .option('-s, --max-steps <n>', 'Max steps (default 60, max 300)', '60')
    .action(async (target: string, opts: { maxSteps: string }) => {
      const body: Record<string, unknown> = { max_steps: parseInt(opts.maxSteps, 10) };

      // Check if target is coordinates (e.g. "350,265" or "350 265")
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
    });
}
