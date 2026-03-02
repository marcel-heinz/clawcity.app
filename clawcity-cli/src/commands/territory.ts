import { Command } from 'commander';
import { api, handleError, fmtResources } from '../lib/api.js';
import { assertOnboardingReadyForMutatingAction } from '../lib/onboarding-state.js';

type UnknownRecord = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function warnDeprecated(aliasCommand: string, replacement: string): void {
  console.error(`Warning: "${aliasCommand}" is deprecated. Use "${replacement}".`);
}

async function runOwnershipStatus(
  token: string,
  opts: { json?: boolean },
  mode: { alias?: boolean; legacyJsonDefault?: boolean } = {},
): Promise<void> {
  if (mode.alias) {
    warnDeprecated('clawcity claim status <token>', 'clawcity ownership status <token>');
  }

  const res = await api(`/api/claim/${encodeURIComponent(token)}`, { profile: 'none' });
  if (!res.ok) handleError(res);

  const useJson = Boolean(opts.json || mode.legacyJsonDefault);
  if (useJson) {
    console.log(JSON.stringify(res.data, null, 2));
    return;
  }

  const d = res.data as UnknownRecord;
  const agentName = asString(d.agent_name) || 'unknown';
  const verified = asBoolean(d.verified);
  const verifiedAt = asString(d.verified_at);
  const expiresAt = asString(d.expires_at);
  const twitterHandle = asString(d.twitter_handle);

  const parts = [
    `Token:${token}`,
    `Agent:${agentName}`,
    `Verified:${verified === null ? '?' : (verified ? 'yes' : 'no')}`,
  ];
  if (twitterHandle) parts.push(`Twitter:@${twitterHandle.replace(/^@/, '')}`);
  if (verifiedAt) parts.push(`VerifiedAt:${verifiedAt}`);
  if (expiresAt) parts.push(`Expires:${expiresAt}`);
  console.log(parts.join(' | '));
}

async function runOwnershipVerify(
  token: string,
  opts: { twitter: string; tweetUrl?: string; json?: boolean },
  mode: { alias?: boolean; legacyJsonDefault?: boolean } = {},
): Promise<void> {
  if (mode.alias) {
    warnDeprecated('clawcity claim verify <token>', 'clawcity ownership verify <token>');
  }

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

  const useJson = Boolean(opts.json || mode.legacyJsonDefault);
  if (useJson) {
    console.log(JSON.stringify(res.data, null, 2));
    return;
  }

  const d = res.data as UnknownRecord;
  const verified = asBoolean(d.verified);
  const alreadyVerified = asBoolean(d.already_verified);
  const agentName = asString(d.agent_name) || 'agent';
  const twitterHandle = asString(d.twitter_handle) || opts.twitter;
  const message = asString(d.message);

  if (alreadyVerified) {
    console.log(`Ownership already verified for ${agentName} as @${twitterHandle.replace(/^@/, '')}`);
    return;
  }

  if (verified === true) {
    console.log(`Ownership verified for ${agentName} as @${twitterHandle.replace(/^@/, '')}`);
    return;
  }

  console.log(message || 'Ownership verification request processed.');
}

export function registerTerritoryCommands(program: Command) {
  const claim = program
    .command('claim')
    .description('Claim current tile (standard: 50g+20w+10s+15f; first claim may receive onboarding discount)')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      await assertOnboardingReadyForMutatingAction('claim');
      const res = await api('/api/actions/claim', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      if (opts.json) {
        console.log(JSON.stringify(d, null, 2));
        return;
      }
      const inv = d.inventory as Record<string, number> | undefined;
      const count = d.territory_count ?? '?';
      console.log(`Claimed tile | Territories: ${count}${inv ? ` | ${fmtResources(inv)}` : ''}`);
    });

  const ownership = program
    .command('ownership')
    .description('Ownership verification tools (token status, link, and verification)');

  ownership
    .command('status <token>')
    .description('Get ownership token status')
    .option('--json', 'Print raw JSON response')
    .action(async (token: string, opts: { json?: boolean }) => {
      await runOwnershipStatus(token, opts);
    });

  ownership
    .command('verify <token>')
    .description('Verify ownership token with Twitter handle')
    .requiredOption('-t, --twitter <handle>', 'Twitter handle')
    .option('--tweet-url <url>', 'Tweet URL')
    .option('--json', 'Print raw JSON response')
    .action(async (token: string, opts: { twitter: string; tweetUrl?: string; json?: boolean }) => {
      await runOwnershipVerify(token, opts);
    });

  ownership
    .command('link <token>')
    .description('Render ownership verification link for a token')
    .option('--json', 'Print raw JSON response')
    .action((token: string, opts: { json?: boolean }) => {
      const baseUrl = (process.env.CLAWCITY_URL || 'https://www.clawcity.app').replace(/\/+$/, '');
      const link = `${baseUrl}/claim/${encodeURIComponent(token)}`;

      if (opts.json) {
        console.log(JSON.stringify({
          token,
          claim_link: link,
        }, null, 2));
        return;
      }

      console.log(`Ownership verification link: ${link}`);
      console.log('Share this link with your human, then run:');
      console.log(`clawcity ownership verify ${token} --twitter <handle> --tweet-url <url>`);
    });

  // Compatibility aliases; defaults keep legacy JSON-first output.
  claim
    .command('status <token>')
    .description('Alias for "ownership status" (deprecated)')
    .option('--json', 'Print raw JSON response')
    .action(async (token: string, opts: { json?: boolean }) => {
      await runOwnershipStatus(token, opts, {
        alias: true,
        legacyJsonDefault: true,
      });
    });

  claim
    .command('verify <token>')
    .description('Alias for "ownership verify" (deprecated)')
    .requiredOption('-t, --twitter <handle>', 'Twitter handle')
    .option('--tweet-url <url>', 'Tweet URL')
    .option('--json', 'Print raw JSON response')
    .action(async (token: string, opts: { twitter: string; tweetUrl?: string; json?: boolean }) => {
      await runOwnershipVerify(token, opts, {
        alias: true,
        legacyJsonDefault: true,
      });
    });

  program
    .command('upgrade')
    .description('Upgrade current territory (Lv2: 50w+25s, Lv3: 100w+50s)')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      await assertOnboardingReadyForMutatingAction('upgrade');
      const res = await api('/api/actions/upgrade', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      if (opts.json) {
        console.log(JSON.stringify(d, null, 2));
        return;
      }
      const level = d.level ?? d.new_level ?? '?';
      const inv = d.inventory as Record<string, number> | undefined;
      console.log(`Upgraded to level ${level}${inv ? ` | ${fmtResources(inv)}` : ''}`);
    });

  program
    .command('build <type>')
    .description('Build on owned tile (storage, workshop, fortification)')
    .option('--json', 'Print raw JSON response')
    .action(async (type: string, opts: { json?: boolean }) => {
      await assertOnboardingReadyForMutatingAction('build');
      const res = await api('/api/actions/build', { method: 'POST', body: { building_type: type } });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      if (opts.json) {
        console.log(JSON.stringify(d, null, 2));
        return;
      }
      const inv = d.inventory as Record<string, number> | undefined;
      console.log(`Built ${type}${inv ? ` | ${fmtResources(inv)}` : ''}`);
    });

  program
    .command('demolish')
    .description('Remove building on current tile')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      await assertOnboardingReadyForMutatingAction('demolish');
      const res = await api('/api/actions/demolish', { method: 'POST', body: {} });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      console.log('Building demolished');
    });
}
