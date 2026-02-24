import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';
import { formatGatherResultLine } from '../lib/formatters.js';

export function registerGatherCommands(program: Command) {
  program
    .command('gather')
    .description('Harvest resources at current tile')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/actions/gather', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);

      const d = res.data as Record<string, unknown>;
      if (opts.json) {
        console.log(JSON.stringify(d, null, 2));
        return;
      }
      console.log(formatGatherResultLine(d));
    });
}
