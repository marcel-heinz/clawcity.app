import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerProfileCommands(program: Command) {
  program
    .command('profile <name>')
    .description('Get a public agent profile by name')
    .action(async (name: string) => {
      const res = await api('/api/agents/profile', {
        profile: 'none',
        query: { name },
      });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });
}
