import { generateClaimToken, hashToken } from './game-logic';
import { createServerClient } from './supabase';

export const OWNERSHIP_LINK_TTL_DAYS = 7;

type SupabaseClientLike = ReturnType<typeof createServerClient>;

export type OwnershipState = 'pending' | 'verified' | 'expired';

interface OwnershipClaimRow {
  id: string;
  agent_id: string;
  verified: boolean | null;
  twitter_handle: string | null;
  created_at: string;
  verified_at: string | null;
  expires_at: string | null;
}

interface OwnershipAgentRow {
  id: string;
  name: string;
  created_at: string;
  claimed: boolean;
  claimed_by_twitter: string | null;
}

export interface OwnershipClaimLookup {
  claim_id: string;
  token: string;
  status: OwnershipState;
  verified: boolean;
  twitter_handle: string | null;
  verified_at: string | null;
  expires_at: string | null;
  claim_created_at: string;
  agent: {
    id: string;
    name: string;
    created_at: string;
    claimed: boolean;
    claimed_by_twitter: string | null;
  };
}

export interface OwnershipAgentStatus {
  agent_id: string;
  agent_name: string;
  status: OwnershipState | 'unclaimed';
  claimed: boolean;
  claimed_by_twitter: string | null;
  latest_claim: {
    verified: boolean;
    status: OwnershipState;
    twitter_handle: string | null;
    created_at: string;
    verified_at: string | null;
    expires_at: string | null;
  } | null;
}

export interface OwnershipLinkResult {
  token: string;
  link: string;
  expires_at: string;
}

function isColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : '';
  return message.toLowerCase().includes(columnName.toLowerCase());
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  return code === 'PGRST116';
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

function normalizeClaimRow(row: unknown): OwnershipClaimRow | null {
  if (!row || typeof row !== 'object') return null;
  const claim = row as Partial<OwnershipClaimRow>;
  if (!claim.id || !claim.agent_id || !claim.created_at) return null;

  return {
    id: claim.id,
    agent_id: claim.agent_id,
    verified: claim.verified === true,
    twitter_handle: claim.twitter_handle || null,
    created_at: claim.created_at,
    verified_at: claim.verified_at || null,
    expires_at: claim.expires_at || null,
  };
}

async function findClaimByToken(
  supabase: SupabaseClientLike,
  token: string,
): Promise<{ claim: OwnershipClaimRow | null; error: unknown | null }> {
  const tokenHash = hashToken(token);
  const selectClause = 'id, agent_id, verified, twitter_handle, created_at, verified_at, expires_at';

  const hashLookup = await supabase
    .from('agent_claims')
    .select(selectClause)
    .eq('claim_token_hash', tokenHash)
    .maybeSingle();

  if (!hashLookup.error && hashLookup.data) {
    return { claim: normalizeClaimRow(hashLookup.data), error: null };
  }

  if (hashLookup.error && !isNotFoundError(hashLookup.error) && !isColumnError(hashLookup.error, 'claim_token_hash')) {
    return { claim: null, error: hashLookup.error };
  }

  const plainLookup = await supabase
    .from('agent_claims')
    .select(selectClause)
    .eq('claim_token', token)
    .maybeSingle();

  if (plainLookup.error && !isNotFoundError(plainLookup.error)) {
    return { claim: null, error: plainLookup.error };
  }

  return {
    claim: normalizeClaimRow(plainLookup.data),
    error: null,
  };
}

async function getAgentById(
  supabase: SupabaseClientLike,
  agentId: string,
): Promise<{ agent: OwnershipAgentRow | null; error: unknown | null }> {
  const { data, error } = await supabase
    .from('agents')
    .select('id, name, created_at, claimed, claimed_by_twitter')
    .eq('id', agentId)
    .maybeSingle();

  if (error && !isNotFoundError(error)) {
    return { agent: null, error };
  }

  if (!data) {
    return { agent: null, error: null };
  }

  const row = data as Partial<OwnershipAgentRow>;
  if (!row.id || !row.name || !row.created_at) {
    return { agent: null, error: null };
  }

  return {
    agent: {
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      claimed: row.claimed === true,
      claimed_by_twitter: row.claimed_by_twitter || null,
    },
    error: null,
  };
}

export async function getOwnershipClaimByToken(
  supabase: SupabaseClientLike,
  token: string,
): Promise<{ data: OwnershipClaimLookup | null; error: unknown | null; notFound: boolean }> {
  const { claim, error: claimError } = await findClaimByToken(supabase, token);
  if (claimError) {
    return { data: null, error: claimError, notFound: false };
  }
  if (!claim) {
    return { data: null, error: null, notFound: true };
  }

  const { agent, error: agentError } = await getAgentById(supabase, claim.agent_id);
  if (agentError) {
    return { data: null, error: agentError, notFound: false };
  }
  if (!agent) {
    return { data: null, error: null, notFound: true };
  }

  const status: OwnershipState = claim.verified
    ? 'verified'
    : isExpired(claim.expires_at)
      ? 'expired'
      : 'pending';

  return {
    data: {
      claim_id: claim.id,
      token,
      status,
      verified: claim.verified === true,
      twitter_handle: claim.twitter_handle,
      verified_at: claim.verified_at,
      expires_at: claim.expires_at,
      claim_created_at: claim.created_at,
      agent: {
        id: agent.id,
        name: agent.name,
        created_at: agent.created_at,
        claimed: agent.claimed === true,
        claimed_by_twitter: agent.claimed_by_twitter,
      },
    },
    error: null,
    notFound: false,
  };
}

export function normalizeTwitterHandle(rawHandle: string): string | null {
  const cleanHandle = rawHandle.replace(/^@/, '').trim();
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(cleanHandle)) {
    return null;
  }
  return cleanHandle;
}

export async function verifyOwnershipClaim(
  supabase: SupabaseClientLike,
  input: {
    token: string;
    twitterHandle: string;
    tweetUrl?: string | null;
  },
): Promise<
  | {
      success: true;
      already_verified: boolean;
      data: {
        agent_id: string;
        agent_name: string;
        twitter_handle: string;
        verified_at: string | null;
        tweet_url: string | null;
      };
    }
  | {
      success: false;
      code: 'invalid_token' | 'expired' | 'invalid_handle' | 'internal_error';
      error?: unknown;
    }
> {
  const cleanHandle = normalizeTwitterHandle(input.twitterHandle);
  if (!cleanHandle) {
    return { success: false, code: 'invalid_handle' };
  }

  const lookup = await getOwnershipClaimByToken(supabase, input.token);
  if (lookup.error) {
    return { success: false, code: 'internal_error', error: lookup.error };
  }
  if (lookup.notFound || !lookup.data) {
    return { success: false, code: 'invalid_token' };
  }

  if (lookup.data.status === 'expired') {
    return { success: false, code: 'expired' };
  }

  if (lookup.data.verified) {
    return {
      success: true,
      already_verified: true,
      data: {
        agent_id: lookup.data.agent.id,
        agent_name: lookup.data.agent.name,
        twitter_handle: lookup.data.twitter_handle || cleanHandle,
        verified_at: lookup.data.verified_at,
        tweet_url: input.tweetUrl || null,
      },
    };
  }

  const nowIso = new Date().toISOString();
  const { error: claimUpdateError } = await supabase
    .from('agent_claims')
    .update({
      verified: true,
      twitter_handle: cleanHandle,
      verified_at: nowIso,
    })
    .eq('id', lookup.data.claim_id);

  if (claimUpdateError) {
    return { success: false, code: 'internal_error', error: claimUpdateError };
  }

  const { error: agentUpdateError } = await supabase
    .from('agents')
    .update({
      claimed: true,
      claimed_by_twitter: cleanHandle,
    })
    .eq('id', lookup.data.agent.id);

  if (agentUpdateError) {
    return { success: false, code: 'internal_error', error: agentUpdateError };
  }

  return {
    success: true,
    already_verified: false,
    data: {
      agent_id: lookup.data.agent.id,
      agent_name: lookup.data.agent.name,
      twitter_handle: cleanHandle,
      verified_at: nowIso,
      tweet_url: input.tweetUrl || null,
    },
  };
}

export async function getOwnershipStatusForAgent(
  supabase: SupabaseClientLike,
  agentId: string,
): Promise<{ data: OwnershipAgentStatus | null; error: unknown | null }> {
  const { agent, error: agentError } = await getAgentById(supabase, agentId);
  if (agentError) {
    return { data: null, error: agentError };
  }
  if (!agent) {
    return { data: null, error: null };
  }

  const { data: claimRows, error: claimError } = await supabase
    .from('agent_claims')
    .select('verified, twitter_handle, created_at, verified_at, expires_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (claimError && !isNotFoundError(claimError)) {
    return { data: null, error: claimError };
  }

  const latestClaim = normalizeClaimRow(
    claimRows && claimRows.length > 0
      ? {
          id: 'latest',
          agent_id: agentId,
          verified: claimRows[0].verified,
          twitter_handle: claimRows[0].twitter_handle,
          created_at: claimRows[0].created_at,
          verified_at: claimRows[0].verified_at,
          expires_at: claimRows[0].expires_at,
        }
      : null,
  );

  const latestClaimStatus: OwnershipState | null = latestClaim
    ? latestClaim.verified
      ? 'verified'
      : isExpired(latestClaim.expires_at)
        ? 'expired'
        : 'pending'
    : null;

  return {
    data: {
      agent_id: agent.id,
      agent_name: agent.name,
      status: agent.claimed
        ? 'verified'
        : latestClaimStatus || 'unclaimed',
      claimed: agent.claimed,
      claimed_by_twitter: agent.claimed_by_twitter,
      latest_claim: latestClaim
        ? {
            verified: latestClaim.verified === true,
            status: latestClaimStatus || 'pending',
            twitter_handle: latestClaim.twitter_handle,
            created_at: latestClaim.created_at,
            verified_at: latestClaim.verified_at,
            expires_at: latestClaim.expires_at,
          }
        : null,
    },
    error: null,
  };
}

async function writeClaimToken(
  supabase: SupabaseClientLike,
  params: {
    agentId: string;
    token: string;
    tokenHash: string;
    expiresAt: string;
  },
): Promise<unknown | null> {
  const basePayload = {
    verified: false,
    twitter_handle: null,
    verified_at: null,
    expires_at: params.expiresAt,
  };

  const { data: existingClaim, error: existingClaimError } = await supabase
    .from('agent_claims')
    .select('id')
    .eq('agent_id', params.agentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingClaimError && !isNotFoundError(existingClaimError)) {
    return existingClaimError;
  }

  if (existingClaim?.id) {
    const secureUpdate = await supabase
      .from('agent_claims')
      .update({
        ...basePayload,
        claim_token: '',
        claim_token_hash: params.tokenHash,
      })
      .eq('id', existingClaim.id);

    if (!secureUpdate.error) {
      return null;
    }

    if (!isColumnError(secureUpdate.error, 'claim_token_hash')) {
      return secureUpdate.error;
    }

    const legacyUpdate = await supabase
      .from('agent_claims')
      .update({
        ...basePayload,
        claim_token: params.token,
      })
      .eq('id', existingClaim.id);

    return legacyUpdate.error || null;
  }

  const secureInsert = await supabase
    .from('agent_claims')
    .insert({
      agent_id: params.agentId,
      claim_token: '',
      claim_token_hash: params.tokenHash,
      ...basePayload,
    });

  if (!secureInsert.error) {
    return null;
  }

  if (!isColumnError(secureInsert.error, 'claim_token_hash')) {
    return secureInsert.error;
  }

  const legacyInsert = await supabase
    .from('agent_claims')
    .insert({
      agent_id: params.agentId,
      claim_token: params.token,
      ...basePayload,
    });

  return legacyInsert.error || null;
}

export async function regenerateOwnershipLink(
  supabase: SupabaseClientLike,
  params: {
    agentId: string;
    baseUrl: string;
  },
): Promise<{ data: OwnershipLinkResult | null; error: unknown | null }> {
  const token = generateClaimToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + OWNERSHIP_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const writeError = await writeClaimToken(supabase, {
    agentId: params.agentId,
    token,
    tokenHash,
    expiresAt,
  });

  if (writeError) {
    return { data: null, error: writeError };
  }

  // Best-effort mirror to agents table for environments where claim_token_hash is used there.
  const secureAgentUpdate = await supabase
    .from('agents')
    .update({ claim_token: '', claim_token_hash: tokenHash })
    .eq('id', params.agentId);

  if (secureAgentUpdate.error && isColumnError(secureAgentUpdate.error, 'claim_token_hash')) {
    await supabase
      .from('agents')
      .update({ claim_token: token })
      .eq('id', params.agentId);
  }

  return {
    data: {
      token,
      link: `${params.baseUrl.replace(/\/$/, '')}/claim/${token}`,
      expires_at: expiresAt,
    },
    error: null,
  };
}
