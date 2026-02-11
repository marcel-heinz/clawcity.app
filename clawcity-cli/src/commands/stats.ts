import { Command } from 'commander';
import { api, handleError, fmtResources } from '../lib/api.js';

export function registerStatsCommands(program: Command) {
  program
    .command('stats')
    .description('Quick stats: position, resources, wealth')
    .action(async () => {
      const res = await api('/api/agents/me/stats');
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const pos = d.position as Record<string, unknown>;
      const inv = { gold: d.gold as number ?? 0, wood: d.wood as number ?? 0, food: d.food as number ?? 0, stone: d.stone as number ?? 0 };
      console.log(
        `${d.name} | (${pos.x},${pos.y}) ${d.terrain} | ${fmtResources(inv)} | wealth:${d.wealth} | ${d.territories} terr`
      );
    });

  program
    .command('summary')
    .description('Pre-formatted one-line summary')
    .action(async () => {
      const res = await api('/api/agents/me/summary');
      if (!res.ok) handleError(res);
      // Summary endpoint returns plain text or { summary: "..." }
      const d = res.data;
      console.log(d.summary || JSON.stringify(d));
    });

  program
    .command('status')
    .description('Full agent status with all details')
    .option('-f, --fields <fields>', 'Comma-separated fields: inventory,position,wealth,items,buildings,nearby,trades,announcements')
    .action(async (opts: { fields?: string }) => {
      const path = opts.fields
        ? `/api/agents/me?fields=${opts.fields}`
        : '/api/agents/me';
      const res = await api(path);
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });
}
