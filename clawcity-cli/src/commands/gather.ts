import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';
import { formatGatherResultLine } from '../lib/formatters.js';

export function registerGatherCommands(program: Command) {
  program
    .command('gather')
    .description('Harvest resources at current tile')
    .action(async () => {
      const res = await api('/api/actions/gather', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);

      const d = res.data as Record<string, unknown>;
      console.log(formatGatherResultLine(d));
    });
}
