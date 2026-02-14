import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

/** Parse resource string like "10gold" or "gold:10" or "10g" into { gold: 10 } */
function parseResources(str: string): Record<string, number> {
  const result: Record<string, number> = {};
  const shorts: Record<string, string> = { g: 'gold', w: 'wood', f: 'food', s: 'stone' };

  // Support "10g,5w" or "10gold+5wood" or "gold:10,wood:5"
  const parts = str.split(/[,+&]/);
  for (const part of parts) {
    const trimmed = part.trim();
    // "10g" or "10gold"
    const numFirst = trimmed.match(/^(\d+)\s*([a-z]+)$/i);
    if (numFirst) {
      const key = shorts[numFirst[2].toLowerCase()] || numFirst[2].toLowerCase();
      result[key] = parseInt(numFirst[1], 10);
      continue;
    }
    // "gold:10" or "gold 10"
    const nameFirst = trimmed.match(/^([a-z]+)[:\s]+(\d+)$/i);
    if (nameFirst) {
      const key = shorts[nameFirst[1].toLowerCase()] || nameFirst[1].toLowerCase();
      result[key] = parseInt(nameFirst[2], 10);
    }
  }
  return result;
}

export function registerTradeCommands(program: Command) {
  const trade = program
    .command('trade')
    .description('Trade with other agents');

  // If called without subcommand, show help and exit success to avoid hard failures in auto-mode.
  trade.action(() => {
    trade.help({ error: false });
  });

  trade
    .command('create <target> <offer> <request>')
    .description('Propose a trade (e.g. trade create AgentName "10gold" "5wood")')
    .action(async (target: string, offer: string, request: string) => {
      const res = await api('/api/actions/trade', {
        method: 'POST',
        body: { target, offer: parseResources(offer), request: parseResources(request) },
      });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      console.log(`Trade proposed to ${target} | ID: ${d.trade_id || d.id || '?'}`);
    });

  trade
    .command('accept <trade_id>')
    .description('Accept a pending trade')
    .action(async (tradeId: string) => {
      const res = await api('/api/actions/trade', {
        method: 'POST',
        body: { action: 'accept', trade_id: tradeId },
      });
      if (!res.ok) handleError(res);
      console.log(`Trade ${tradeId} accepted`);
    });

  trade
    .command('reject <trade_id>')
    .description('Reject a pending trade')
    .action(async (tradeId: string) => {
      const res = await api('/api/actions/trade', {
        method: 'POST',
        body: { action: 'reject', trade_id: tradeId },
      });
      if (!res.ok) handleError(res);
      console.log(`Trade ${tradeId} rejected`);
    });
}
