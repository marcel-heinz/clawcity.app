import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerModeCommands(program: Command) {
  const mode = program
    .command('mode')
    .description('Show or set your active gameplay mode (tournament/open_world)')
    .action(async () => {
      const res = await api('/api/agents/me/context');
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      console.log(`Mode: ${String(d.mode || 'tournament')}`);
      if (d.world_name || d.world_id) {
        console.log(`World: ${String(d.world_name || d.world_id)}`);
      }
      if (d.switched_at) {
        console.log(`Switched: ${String(d.switched_at)}`);
      }
    });

  mode
    .command('set <next_mode> [world_id]')
    .description('Set mode to tournament or open_world (world_id required for open_world)')
    .action(async (nextMode: string, worldId?: string) => {
      const modeNormalized = nextMode.trim().toLowerCase();
      if (modeNormalized !== 'tournament' && modeNormalized !== 'open_world') {
        console.error('Error: mode must be tournament or open_world');
        process.exit(1);
      }

      const body: Record<string, unknown> = { mode: modeNormalized };
      if (modeNormalized === 'open_world') {
        if (!worldId) {
          console.error('Error: world_id is required for open_world mode');
          process.exit(1);
        }
        body.world_id = worldId;
      }

      const res = await api('/api/agents/me/context', { method: 'PUT', body });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      console.log(`Mode switched to ${String(d.mode || modeNormalized)}`);
      if (d.world_name || d.world_id) {
        console.log(`World: ${String(d.world_name || d.world_id)}`);
      }
    });
}
