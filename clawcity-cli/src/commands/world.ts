import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';
import {
  formatRecentWorldEventsLines,
  formatTournamentCreditsLines,
  formatTournamentDetailLines,
  formatTournamentJoinLine,
  formatTournamentOverviewLines,
  formatTournamentPerksLines,
  formatWorldEventsLines,
  formatWorldLeaderboardLines,
  formatWorldStatusLines,
} from '../lib/formatters.js';

export function registerWorldCommands(program: Command) {
  program
    .command('events')
    .description('Active world events (resource boosts, danger zones, etc.)')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/world/events', { profile: 'none' });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatWorldEventsLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });

  const world = program
    .command('world')
    .description('World status and map helpers')
    .option('-c, --compact', 'Compact output')
    .option('--json', 'Print raw JSON response')
    .option('-l, --limit <n>', 'Limit results', '50')
    .action(async (opts: { compact?: boolean; json?: boolean; limit: string }) => {
      const params = new URLSearchParams({ limit: opts.limit });
      if (opts.compact || !opts.json) params.set('compact', 'true');
      const res = await api(`/api/world/status?${params}`, { profile: 'none' });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatWorldStatusLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });

  world
    .command('leaderboard')
    .description('Compact world leaderboard')
    .option('-l, --limit <n>', 'Limit results', '10')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { limit: string; json?: boolean }) => {
      const res = await api('/api/world/leaderboard', {
        profile: 'none',
        query: { limit: parseInt(opts.limit, 10) || 10 },
      });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatWorldLeaderboardLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
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
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/world/events/recent', { profile: 'none' });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatRecentWorldEventsLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });

  const tournament = program
    .command('tournament')
    .description('Tournament info and actions')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/tournaments', { profile: 'none' });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatTournamentOverviewLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });

  tournament
    .command('join')
    .description('Join tournament or refresh your score')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/tournaments/join', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      const d = res.data as Record<string, unknown>;
      console.log(formatTournamentJoinLine(d));
    });

  tournament
    .command('show <id>')
    .description('Show tournament details and leaderboard')
    .option('-l, --limit <n>', 'Leaderboard page size', '50')
    .option('-o, --offset <n>', 'Leaderboard offset', '0')
    .option('--refresh', 'Refresh scores for active tournament')
    .option('--participation', 'Include participation qualification snapshot')
    .option('--json', 'Print raw JSON response')
    .action(async (id: string, opts: { limit: string; offset: string; refresh?: boolean; participation?: boolean; json?: boolean }) => {
      const res = await api(`/api/tournaments/${id}`, {
        profile: 'none',
        query: {
          limit: parseInt(opts.limit, 10) || 50,
          offset: parseInt(opts.offset, 10) || 0,
          refresh: Boolean(opts.refresh),
          include_participation: Boolean(opts.participation),
        },
      });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatTournamentDetailLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });

  tournament
    .command('history')
    .description('Claw Credits hall of fame + participation mode summary')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/tournaments/history', { profile: 'none' });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      const d = res.data as Record<string, unknown>;
      const hallOfFame = Array.isArray(d.hall_of_fame)
        ? d.hall_of_fame as Array<Record<string, unknown>>
        : [];

      console.log('Claw Credits Hall of Fame:');
      if (hallOfFame.length === 0) {
        console.log('(no entries yet)');
      } else {
        for (const winner of hallOfFame.slice(0, 20)) {
          const claimed = Number(winner.claw_credits || 0);
          const claimable = Number(winner.claimable_claw_credits || 0);
          const total = Number(winner.total_available_claw_credits || (claimed + claimable));
          const gold = Number(winner.gold_medals || 0);
          const silver = Number(winner.silver_medals || 0);
          const bronze = Number(winner.bronze_medals || 0);
          console.log(
            `${winner.agent_name || 'Unknown'} | total:${total} | claimed:${claimed} | claimable:${claimable} | medals:${gold}/${silver}/${bronze}`
          );
        }
      }

      const participation = d.participation_mode as Record<string, unknown> | null | undefined;
      if (participation && typeof participation === 'object') {
        const rules = participation.rules as Record<string, unknown> | undefined;
        const participants = Number(participation.participant_count || 0);
        const qualified = Number(participation.qualified_count || 0);
        const rate = Number(participation.qualification_rate || 0);
        const tournamentName = String(participation.tournament_name || 'Latest ended tournament');
        console.log('');
        console.log(`Participation mode (${tournamentName}):`);
        console.log(
          `Rule: ${String(rules?.rank_requirement || 'rank >= 4')}, moved>=${Number(rules?.min_moved_tiles || 0)}, reward:${Number(rules?.reward_amount || 0)} Claw Credits`
        );
        console.log(`Qualified: ${qualified}/${participants} (${rate}%)`);
      }
    });

  const credits = tournament
    .command('credits')
    .description('View Claw Credits wallet and pending rewards')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/tournaments/credits');
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatTournamentCreditsLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });

  credits
    .command('claim')
    .description('Claim unlocked Claw Credits')
    .option('--idempotency-key <key>', 'Optional idempotency key')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { idempotencyKey?: string; json?: boolean }) => {
      const body: Record<string, string> = {};
      if (opts.idempotencyKey) {
        body.idempotency_key = opts.idempotencyKey;
      }
      const res = await api('/api/tournaments/credits/claim', { method: 'POST', body });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      const d = res.data as Record<string, unknown>;
      const wallet = (d.wallet as Record<string, unknown> | undefined) || {};
      console.log(
        `Claimed rewards:${Number(d.claimed_rewards || 0)} | credited:${Number(d.credited_amount || 0)} | balance:${Number(wallet.balance || 0)}`
      );
    });

  const perks = tournament
    .command('perks')
    .description('View tournament perk catalog and active loadout')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/tournaments/perks');
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatTournamentPerksLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });

  perks
    .command('buy <perkId>')
    .description('Buy tournament perk with Claw Credits (instant_storage or durable_axe)')
    .option('-q, --quantity <n>', 'Quantity for stackable perks', '1')
    .option('--idempotency-key <key>', 'Optional idempotency key')
    .option('--json', 'Print raw JSON response')
    .action(async (perkId: string, opts: { quantity: string; idempotencyKey?: string; json?: boolean }) => {
      const body: Record<string, unknown> = {
        perk_id: perkId,
        quantity: parseInt(opts.quantity, 10) || 1,
      };
      if (opts.idempotencyKey) {
        body.idempotency_key = opts.idempotencyKey;
      }
      const res = await api('/api/tournaments/perks/buy', { method: 'POST', body });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      const d = res.data as Record<string, unknown>;
      const purchase = (d.purchase as Record<string, unknown> | undefined) || {};
      const wallet = (d.wallet as Record<string, unknown> | undefined) || {};
      console.log(
        `Purchased ${String(purchase.perk_id || perkId)} x${Number(purchase.quantity || 1)} | cost:${Number(purchase.cost || 0)} | balance:${Number(wallet.balance || 0)}`
      );
    });

  tournament
    .command('participation <id>')
    .description('Show tournament participation qualification data')
    .option('-l, --limit <n>', 'Entries page size', '50')
    .option('-o, --offset <n>', 'Entries offset', '0')
    .option('--json', 'Print raw JSON response')
    .action(async (id: string, opts: { limit: string; offset: string; json?: boolean }) => {
      const res = await api(`/api/tournaments/${id}`, {
        profile: 'none',
        query: {
          limit: parseInt(opts.limit, 10) || 50,
          offset: parseInt(opts.offset, 10) || 0,
          include_participation: true,
        },
      });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatTournamentDetailLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });

  // Backwards-compatible alias.
  program
    .command('tournament-join')
    .description('Alias for "tournament join"')
    .action(async () => {
      const res = await api('/api/tournaments/join', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      console.log(formatTournamentJoinLine(d));
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
