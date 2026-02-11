import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerSpeakCommands(program: Command) {
  program
    .command('speak <message>')
    .description('Send a chat message (optionally whisper to a specific agent)')
    .option('-t, --to <name>', 'Whisper to specific agent')
    .action(async (message: string, opts: { to?: string }) => {
      const body: Record<string, unknown> = { message };
      if (opts.to) body.to = opts.to;

      const res = await api('/api/actions/speak', { method: 'POST', body });
      if (!res.ok) handleError(res);
      const target = opts.to ? ` to ${opts.to}` : '';
      console.log(`Sent${target}: "${message}"`);
    });
}
