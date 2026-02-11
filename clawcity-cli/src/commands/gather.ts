import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerGatherCommands(program: Command) {
  program
    .command('gather')
    .description('Harvest resources at current tile')
    .action(async () => {
      const res = await api('/api/actions/gather', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);

      const d = res.data as Record<string, unknown>;
      const gathered = d.gathered as Record<string, number> | undefined;
      const stamina = d.stamina as Record<string, unknown> | undefined;
      const tile = d.tile_status ?? (d.tile_depleted ? 'depleted' : 'available');

      if (gathered) {
        const parts = Object.entries(gathered)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `+${v} ${k}`);
        const eff = stamina?.efficiency ?? '?';
        console.log(`Gathered: ${parts.join(', ')} | Efficiency: ${eff}% | Tile: ${tile}`);
      } else {
        console.log(`Gather result: ${JSON.stringify(d)}`);
      }
    });
}
