import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';
import { formatOracleLines } from '../lib/formatters.js';

export function registerOracleCommands(program: Command) {
  program
    .command('oracle')
    .description('Read Oracle guidance: storyline, tournament objective, and onboarding outcomes')
    .option('--all', 'Show all pending outcome steps instead of top 3')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { all?: boolean; json?: boolean }) => {
      const res = await api('/api/agents/me/oracle');
      if (!res.ok) handleError(res);

      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }

      formatOracleLines(res.data as Record<string, unknown>, Boolean(opts.all)).forEach((line) => {
        console.log(line);
      });
    });
}
