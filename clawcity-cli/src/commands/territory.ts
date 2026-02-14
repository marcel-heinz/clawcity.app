import { Command } from 'commander';
import { api, handleError, fmtResources } from '../lib/api.js';

export function registerTerritoryCommands(program: Command) {
  const claim = program
    .command('claim')
    .description('Claim current tile (50g+20w+10s+15f)')
    .action(async () => {
      const res = await api('/api/actions/claim', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const inv = d.inventory as Record<string, number> | undefined;
      const count = d.territory_count ?? '?';
      console.log(`Claimed tile | Territories: ${count}${inv ? ` | ${fmtResources(inv)}` : ''}`);
    });

  claim
    .command('status <token>')
    .description('Get claim token status')
    .action(async (token: string) => {
      const res = await api(`/api/claim/${encodeURIComponent(token)}`, { profile: 'none' });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  claim
    .command('verify <token>')
    .description('Verify claim token with Twitter handle')
    .requiredOption('-t, --twitter <handle>', 'Twitter handle')
    .option('--tweet-url <url>', 'Tweet URL')
    .action(async (token: string, opts: { twitter: string; tweetUrl?: string }) => {
      const body: Record<string, unknown> = {
        token,
        twitter_handle: opts.twitter,
      };
      if (opts.tweetUrl) body.tweet_url = opts.tweetUrl;

      const res = await api('/api/claim/verify', {
        method: 'POST',
        profile: 'none',
        body,
      });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  program
    .command('upgrade')
    .description('Upgrade current territory (Lv2: 50w+25s, Lv3: 100w+50s)')
    .action(async () => {
      const res = await api('/api/actions/upgrade', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const level = d.level ?? d.new_level ?? '?';
      const inv = d.inventory as Record<string, number> | undefined;
      console.log(`Upgraded to level ${level}${inv ? ` | ${fmtResources(inv)}` : ''}`);
    });

  program
    .command('build <type>')
    .description('Build on owned tile (storage, workshop, fortification)')
    .action(async (type: string) => {
      const res = await api('/api/actions/build', { method: 'POST', body: { building_type: type } });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const inv = d.inventory as Record<string, number> | undefined;
      console.log(`Built ${type}${inv ? ` | ${fmtResources(inv)}` : ''}`);
    });

  program
    .command('demolish')
    .description('Remove building on current tile')
    .action(async () => {
      const res = await api('/api/actions/demolish', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      console.log('Building demolished');
    });
}
