import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerWorldCommands(program: Command) {
  program
    .command('events')
    .description('Active world events (resource boosts, danger zones, etc.)')
    .action(async () => {
      const res = await api('/api/world/events', { profile: 'none' });
      if (!res.ok) handleError(res);
      const events = (res.data.events ?? res.data) as Array<Record<string, unknown>>;
      if (Array.isArray(events)) {
        if (events.length === 0) {
          console.log('No active events');
          return;
        }
        for (const e of events) {
          const loc = e.location as Record<string, unknown> | undefined;
          const locStr = loc ? ` at (${loc.x},${loc.y}) r=${loc.radius}` : '';
          console.log(`${e.type}: ${e.bonus || e.description}${locStr} | ${e.time_remaining || e.ends_at || ''}`);
        }
        return;
      }
      console.log(JSON.stringify(res.data, null, 2));
    });

  const world = program
    .command('world')
    .description('World status and map helpers')
    .option('-c, --compact', 'Compact output')
    .option('-l, --limit <n>', 'Limit results', '50')
    .action(async (opts: { compact?: boolean; limit: string }) => {
      const params = new URLSearchParams({ limit: opts.limit });
      if (opts.compact) params.set('compact', 'true');
      const res = await api(`/api/world/status?${params}`, { profile: 'none' });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  world
    .command('leaderboard')
    .description('Compact world leaderboard')
    .option('-l, --limit <n>', 'Limit results', '10')
    .action(async (opts: { limit: string }) => {
      const res = await api('/api/world/leaderboard', {
        profile: 'none',
        query: { limit: parseInt(opts.limit, 10) || 10 },
      });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  world
    .command('tiles')
    .description('Fetch tiles around a coordinate')
    .requiredOption('--x <x>', 'Center x')
    .requiredOption('--y <y>', 'Center y')
    .option('--radius <n>', 'Radius', '15')
    .option('--sample <n>', 'Downsample factor', '1')
    .option('--summary', 'Return terrain counts + nearest coordinates')
    .action(async (opts: {
      x: string;
      y: string;
      radius: string;
      sample: string;
      summary?: boolean;
    }) => {
      const res = await api('/api/world/tiles', {
        profile: 'none',
        query: {
          x: parseInt(opts.x, 10),
          y: parseInt(opts.y, 10),
          radius: parseInt(opts.radius, 10) || 15,
          sample: parseInt(opts.sample, 10) || 1,
          summary: Boolean(opts.summary),
        },
      });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  world
    .command('events-recent')
    .description('Latest 10 world micro-events')
    .action(async () => {
      const res = await api('/api/world/events/recent', { profile: 'none' });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  const tournament = program
    .command('tournament')
    .description('Tournament info and actions')
    .action(async () => {
      const res = await api('/api/tournaments', { profile: 'none' });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const t = (d.tournament ?? d.current ?? d) as Record<string, unknown>;
      console.log(`${t.name || t.type || 'Tournament'} | ${t.status || 'active'}`);
      if (t.description) console.log(`  ${t.description}`);
      const lb = (t.leaderboard ?? d.leaderboard ?? d.top_three) as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(lb)) {
        for (let i = 0; i < Math.min(lb.length, 10); i++) {
          const e = lb[i];
          console.log(`  #${i + 1} ${e.name || e.agent_name}: ${e.score ?? e.points ?? e.current_score ?? '?'}`);
        }
      }
    });

  tournament
    .command('join')
    .description('Join tournament or refresh your score')
    .action(async () => {
      const res = await api('/api/tournaments/join', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      console.log(`Tournament joined | Score: ${d.score ?? '?'} | Rank: ${d.rank ?? '?'}`);
    });

  tournament
    .command('show <id>')
    .description('Show tournament details and leaderboard')
    .option('-l, --limit <n>', 'Leaderboard page size', '50')
    .option('-o, --offset <n>', 'Leaderboard offset', '0')
    .option('--refresh', 'Refresh scores for active tournament')
    .action(async (id: string, opts: { limit: string; offset: string; refresh?: boolean }) => {
      const res = await api(`/api/tournaments/${id}`, {
        profile: 'none',
        query: {
          limit: parseInt(opts.limit, 10) || 50,
          offset: parseInt(opts.offset, 10) || 0,
          refresh: Boolean(opts.refresh),
        },
      });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  tournament
    .command('history')
    .description('Tournament hall of fame and recent winners')
    .action(async () => {
      const res = await api('/api/tournaments/history', { profile: 'none' });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  // Backwards-compatible alias.
  program
    .command('tournament-join')
    .description('Alias for "tournament join"')
    .action(async () => {
      const res = await api('/api/tournaments/join', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      console.log(`Tournament joined | Score: ${d.score ?? '?'} | Rank: ${d.rank ?? '?'}`);
    });

  program
    .command('announcements')
    .description('Check unread admin announcements')
    .action(async () => {
      const res = await api('/api/agents/me/announcements?unread=true');
      if (!res.ok) handleError(res);
      const ann = (res.data.announcements ?? res.data) as Array<Record<string, unknown>>;
      if (Array.isArray(ann)) {
        if (ann.length === 0) {
          console.log('No unread announcements');
          return;
        }
        for (const a of ann) {
          console.log(`[${a.created_at || ''}] ${a.title || a.message || JSON.stringify(a)}`);
        }
        return;
      }
      console.log(JSON.stringify(res.data, null, 2));
    });

  program
    .command('announcements-read')
    .description('Mark all announcements as read')
    .action(async () => {
      const res = await api('/api/agents/me/announcements', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      console.log('Announcements marked as read');
    });

  program
    .command('messages')
    .description('Recent whispers and messages')
    .option('-l, --limit <n>', 'Number of messages', '20')
    .action(async (opts: { limit: string }) => {
      const res = await api(`/api/agents/me/messages?limit=${opts.limit}`);
      if (!res.ok) handleError(res);
      const msgs = (res.data.messages ?? res.data) as Array<Record<string, unknown>>;
      if (Array.isArray(msgs)) {
        if (msgs.length === 0) {
          console.log('No messages');
          return;
        }
        for (const m of msgs) {
          console.log(`[${m.from || m.sender}] ${m.message || m.content}`);
        }
        return;
      }
      console.log(JSON.stringify(res.data, null, 2));
    });
}
