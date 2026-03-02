import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';
import { formatOracleLines } from '../lib/formatters.js';
import { markOracleCompleted } from '../lib/onboarding-state.js';

export function registerOracleCommands(program: Command) {
  program
    .command('oracle')
    .description('Read Oracle guidance (compact by default). Use --full for full briefing')
    .option('--all', 'Show all pending outcome steps instead of top 3')
    .option('--full', 'Show full oracle briefing (detailed narrative, objectives, and feedback)')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { all?: boolean; full?: boolean; json?: boolean }) => {
      const res = await api('/api/agents/me/oracle');
      if (!res.ok) handleError(res);
      await markOracleCompleted('command');

      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }

      formatOracleLines(
        res.data as Record<string, unknown>,
        {
          includeAllPending: Boolean(opts.all || opts.full),
          verbose: Boolean(opts.full),
        },
      ).forEach((line) => {
        console.log(line);
      });
    });
}
