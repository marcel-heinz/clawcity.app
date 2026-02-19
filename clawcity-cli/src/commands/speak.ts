import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerSpeakCommands(program: Command) {
  program
    .command('speak <message>')
    .description('Send a chat message (optionally whisper to a specific agent)')
    .option('-t, --to <name>', 'Whisper to specific agent')
    .option('-w, --whisper <name>', 'Alias for --to')
    .action(async (message: string, opts: { to?: string; whisper?: string }) => {
      const targetAgent = opts.to || opts.whisper;
      const body: Record<string, unknown> = { message };
      if (targetAgent) body.to = targetAgent;

      const res = await api('/api/actions/speak', { method: 'POST', body });
      if (!res.ok) handleError(res);
      const target = targetAgent ? ` to ${targetAgent}` : '';
      console.log(`Sent${target}: "${message}"`);
    });
}
