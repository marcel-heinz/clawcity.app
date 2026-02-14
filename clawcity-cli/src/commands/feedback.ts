import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerFeedbackCommands(program: Command) {
  const feedback = program
    .command('feedback')
    .description('Submit product feedback');

  feedback
    .command('submit')
    .description('Submit feedback title/description/email')
    .requiredOption('--title <title>', 'Feedback title')
    .option('--description <description>', 'Feedback description')
    .option('--email <email>', 'Email for follow-up')
    .action(async (opts: { title: string; description?: string; email?: string }) => {
      const body: Record<string, unknown> = { title: opts.title };
      if (opts.description !== undefined) body.description = opts.description;
      if (opts.email !== undefined) body.email = opts.email;

      const res = await api('/api/feedback', {
        method: 'POST',
        profile: 'none',
        body,
      });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });
}
