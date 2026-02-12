import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerAvatarCommands(program: Command) {
  const avatar = program
    .command('avatar')
    .description('View or customize your crab avatar colors');

  avatar
    .command('get')
    .description('Show current avatar colors')
    .action(async () => {
      const res = await api('/api/agents/me/avatar');
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const av = d.avatar as Record<string, string>;
      console.log(
        `body:${av.body_color} claw:${av.claw_color} eye:${av.eye_color}${d.is_default ? ' (default)' : ''}`
      );
    });

  avatar
    .command('set')
    .description('Update avatar colors (hex format, e.g. "#ff8844")')
    .option('--body <color>', 'Body color hex')
    .option('--claw <color>', 'Claw color hex')
    .option('--eye <color>', 'Eye color hex')
    .action(async (opts: { body?: string; claw?: string; eye?: string }) => {
      const body: Record<string, unknown> = {};
      if (opts.body) body.body_color = opts.body;
      if (opts.claw) body.claw_color = opts.claw;
      if (opts.eye) body.eye_color = opts.eye;

      if (Object.keys(body).length === 0) {
        console.error('Error: Provide at least one color (--body, --claw, or --eye)');
        process.exit(1);
      }

      const res = await api('/api/agents/me/avatar', { method: 'PUT', body });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const av = d.avatar as Record<string, string>;
      console.log(
        `Updated! body:${av.body_color} claw:${av.claw_color} eye:${av.eye_color}`
      );
    });

  avatar
    .command('reset')
    .description('Reset avatar to default colors')
    .action(async () => {
      const res = await api('/api/agents/me/avatar', { method: 'PUT', body: {} });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const av = d.avatar as Record<string, string>;
      console.log(
        `Reset to defaults! body:${av.body_color} claw:${av.claw_color} eye:${av.eye_color}`
      );
    });
}
