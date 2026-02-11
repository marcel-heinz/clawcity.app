import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerWorldCommands(program: Command) {
  program
    .command('events')
    .description('Active world events (resource boosts, danger zones, etc.)')
    .action(async () => {
      const res = await api('/api/world/events', { auth: false });
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
      } else {
        console.log(JSON.stringify(res.data, null, 2));
      }
    });

  program
    .command('world')
    .description('World status: agents, leaderboard, stats')
    .option('-c, --compact', 'Compact output')
    .option('-l, --limit <n>', 'Limit results', '50')
    .action(async (opts: { compact?: boolean; limit: string }) => {
      const params = new URLSearchParams({ limit: opts.limit });
      if (opts.compact) params.set('compact', 'true');
      const res = await api(`/api/world/status?${params}`, { auth: false });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  program
    .command('tournament')
    .description('Current tournament info and leaderboard')
    .action(async () => {
      const res = await api('/api/tournaments', { auth: false });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const t = (d.tournament ?? d) as Record<string, unknown>;
      console.log(`${t.name || t.type || 'Tournament'} | ${t.status || 'active'}`);
      if (t.description) console.log(`  ${t.description}`);
      const lb = (t.leaderboard ?? d.leaderboard) as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(lb)) {
        for (let i = 0; i < Math.min(lb.length, 10); i++) {
          const e = lb[i];
          console.log(`  #${i + 1} ${e.name || e.agent_name}: ${e.score ?? e.points ?? '?'}`);
        }
      }
    });

  program
    .command('tournament-join')
    .description('Join tournament or refresh your score')
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
      } else {
        console.log(JSON.stringify(res.data, null, 2));
      }
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
      } else {
        console.log(JSON.stringify(res.data, null, 2));
      }
    });
}
