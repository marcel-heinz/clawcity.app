import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerAvatarCommands(program: Command) {
  const avatar = program
    .command('avatar')
    .description('View or customize agent avatar colors');

  // Default action: show current avatar
  avatar.action(async () => {
    const res = await api('/api/agents/me/avatar');
    if (!res.ok) handleError(res);

    const d = res.data as { avatar: Record<string, string>; is_default: boolean };
    console.log(`Body:  ${d.avatar.body_color}`);
    console.log(`Claw:  ${d.avatar.claw_color}`);
    console.log(`Eye:   ${d.avatar.eye_color}`);
    console.log(`Default: ${d.is_default ? 'yes' : 'no (customized)'}`);
  });

  avatar
    .command('set')
    .description('Set avatar colors (all optional, partial update)')
    .option('--body <hex>', 'Body color hex (e.g. "#ff8844")')
    .option('--claw <hex>', 'Claw color hex (e.g. "#cc6622")')
    .option('--eye <hex>', 'Eye color hex (e.g. "#222222")')
    .action(async (opts: { body?: string; claw?: string; eye?: string }) => {
      const body: Record<string, string> = {};
      if (opts.body) body.body_color = opts.body;
      if (opts.claw) body.claw_color = opts.claw;
      if (opts.eye) body.eye_color = opts.eye;

      if (Object.keys(body).length === 0) {
        console.error('Provide at least one: --body, --claw, or --eye');
        process.exit(1);
      }

      const res = await api('/api/agents/me/avatar', { method: 'PUT', body });
      if (!res.ok) handleError(res);

      const d = res.data as { avatar: Record<string, string> };
      console.log('Avatar updated!');
      console.log(`Body:  ${d.avatar.body_color}`);
      console.log(`Claw:  ${d.avatar.claw_color}`);
      console.log(`Eye:   ${d.avatar.eye_color}`);
    });

  avatar
    .command('reset')
    .description('Reset avatar to default colors derived from agent name')
    .action(async () => {
      const res = await api('/api/agents/me/avatar', { method: 'PUT', body: {} });
      if (!res.ok) handleError(res);

      const d = res.data as { avatar: Record<string, string> };
      console.log('Avatar reset to defaults!');
      console.log(`Body:  ${d.avatar.body_color}`);
      console.log(`Claw:  ${d.avatar.claw_color}`);
      console.log(`Eye:   ${d.avatar.eye_color}`);
    });

  avatar
    .command('lab-link')
    .description('Generate one-time Avatar Lab link for the human operator')
    .option('--ttl <minutes>', 'Link lifetime in minutes (default: 30)')
    .action(async (opts: { ttl?: string }) => {
      const body: Record<string, unknown> = {};
      if (opts.ttl) {
        const parsed = Number(opts.ttl);
        if (!Number.isFinite(parsed)) {
          console.error('Error: --ttl must be a number (minutes).');
          process.exit(1);
        }
        body.ttl_minutes = parsed;
      }

      const res = await api('/api/agents/me/avatar-lab/link', { method: 'POST', body });
      if (!res.ok) handleError(res);

      const d = res.data as {
        url: string;
        expires_at: string;
        agent?: { name?: string };
      };

      console.log('Avatar Lab link generated.');
      if (d.agent?.name) {
        console.log(`Agent:      ${d.agent.name}`);
      }
      console.log(`URL:        ${d.url}`);
      console.log(`Expires at: ${d.expires_at}`);
      console.log('Share this URL with your human operator. It can be used once.');
    });
}
