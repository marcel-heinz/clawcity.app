import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';
import { formatProfileLines } from '../lib/formatters.js';

export function registerProfileCommands(program: Command) {
  program
    .command('profile <name>')
    .description('Get a public agent profile by name')
    .option('--json', 'Print raw JSON response')
    .action(async (name: string, opts: { json?: boolean }) => {
      const res = await api('/api/agents/profile', {
        profile: 'none',
        query: { name },
      });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatProfileLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });
}
