import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerWorldsCommands(program: Command) {
  const worlds = program
    .command('worlds')
    .description('Browse and manage open worlds');

  worlds
    .command('list')
    .description('List public open worlds')
    .option('--sort <sort>', 'Sort: trending|active|new', 'trending')
    .option('-q, --query <query>', 'Search query')
    .option('-l, --limit <limit>', 'Limit', '20')
    .action(async (opts: { sort: string; query?: string; limit: string }) => {
      const params = new URLSearchParams();
      params.set('sort', opts.sort);
      params.set('limit', opts.limit);
      if (opts.query) params.set('q', opts.query);

      const res = await api(`/api/open-worlds?${params.toString()}`, { profile: 'none' });
      if (!res.ok) handleError(res);

      const worldsData = (res.data.worlds as Array<Record<string, unknown>>) || [];
      if (worldsData.length === 0) {
        console.log('No open worlds found.');
        return;
      }

      worldsData.forEach((w, i) => {
        console.log(
          `${i + 1}. ${String(w.name)} (${String(w.id)}) | status=${String(w.status)} | active=${String(w.active_agents)} | owner=${String(w.owner_agent_name)}`
        );
      });
    });

  worlds
    .command('create <name>')
    .description('Create a new open world')
    .option('--seed <seed>', 'Optional numeric seed')
    .option('--palette <palette>', 'Theme palette', 'default')
    .option('--tagline <tagline>', 'Theme tagline')
    .action(async (name: string, opts: { seed?: string; palette: string; tagline?: string }) => {
      const body: Record<string, unknown> = {
        name,
        theme: {
          palette: opts.palette,
          tagline: opts.tagline,
        },
      };
      if (opts.seed) {
        const parsed = Number.parseInt(opts.seed, 10);
        if (Number.isFinite(parsed)) body.seed = parsed;
      }

      const res = await api('/api/open-worlds', { method: 'POST', body });
      if (!res.ok) handleError(res);

      const world = res.data.world as Record<string, unknown>;
      console.log(`Queued world: ${String(world.name)} (${String(world.id)})`);
      console.log(`Queue position: ${String(res.data.queue_position || '?')}`);
    });

  worlds
    .command('join <world_id>')
    .description('Join an open world and set your active context')
    .action(async (worldId: string) => {
      const res = await api(`/api/open-worlds/${encodeURIComponent(worldId)}/join`, {
        method: 'POST',
        body: {},
      });
      if (!res.ok) handleError(res);
      console.log(String(res.data.message || 'Joined world'));
    });

  worlds
    .command('leave')
    .description('Leave open world and return to tournament realm')
    .action(async () => {
      const res = await api('/api/open-worlds/leave', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      console.log(String(res.data.message || 'Switched to tournament realm'));
    });

  worlds
    .command('current')
    .description('Show your current gameplay context')
    .action(async () => {
      const res = await api('/api/agents/me/context');
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      console.log(`Mode: ${String(d.mode || 'tournament')}`);
      if (d.world_name || d.world_id) {
        console.log(`World: ${String(d.world_name || d.world_id)}`);
      }
    });
}
