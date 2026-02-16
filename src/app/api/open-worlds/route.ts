import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { OpenWorldSummary } from '@/lib/types';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

async function resolveUniqueSlug(base: string): Promise<string> {
  const supabase = createServerClient();
  let candidate = base || `world-${Math.floor(Math.random() * 1_000_000)}`;
  let suffix = 1;

  while (true) {
    const { data } = await supabase
      .from('open_worlds')
      .select('id')
      .eq('slug', candidate)
      .limit(1)
      .maybeSingle();

    if (!data) return candidate;

    suffix += 1;
    candidate = `${base}-${suffix}`.slice(0, 64);
  }
}

function normalizeTheme(input: unknown): { palette: string; banner_url?: string; tagline?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { palette: 'default' };
  }

  const raw = input as Record<string, unknown>;
  const palette = typeof raw.palette === 'string' && raw.palette.trim() ? raw.palette.trim().slice(0, 48) : 'default';
  const banner_url = typeof raw.banner_url === 'string' && raw.banner_url.trim() ? raw.banner_url.trim().slice(0, 500) : undefined;
  const tagline = typeof raw.tagline === 'string' && raw.tagline.trim() ? raw.tagline.trim().slice(0, 140) : undefined;

  return { palette, banner_url, tagline };
}

function toSummary(
  row: Record<string, unknown>,
  ownerName: string
): OpenWorldSummary {
  const theme = (row.theme && typeof row.theme === 'object' ? row.theme : { palette: 'default' }) as OpenWorldSummary['theme'];

  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    owner_agent_id: row.owner_agent_id as string,
    owner_agent_name: ownerName,
    seed: Number(row.seed ?? 42),
    world_size: 500,
    theme,
    status: (row.status as OpenWorldSummary['status']) || 'queued',
    active_agents: Number(row.active_agents ?? 0),
    joins_24h: Number(row.joins_24h ?? 0),
    events_24h: Number(row.events_24h ?? 0),
    trending_score: Number(row.trending_score ?? 0),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return jsonResponse({ success: true, data: { worlds: [], total: 0 } });
  }

  try {
    const supabase = createServerClient();
    const url = new URL(request.url);

    const sort = url.searchParams.get('sort') || 'trending';
    const q = (url.searchParams.get('q') || '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

    let query = supabase
      .from('open_worlds')
      .select(
        'id, slug, name, owner_agent_id, seed, world_size, theme, status, active_agents, joins_24h, events_24h, trending_score, created_at, updated_at',
        { count: 'exact' }
      )
      .neq('status', 'error');

    if (q) {
      query = query.or(`name.ilike.%${q}%,slug.ilike.%${q}%`);
    }

    if (sort === 'active') {
      query = query.order('active_agents', { ascending: false }).order('events_24h', { ascending: false });
    } else if (sort === 'new') {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order('trending_score', { ascending: false }).order('active_agents', { ascending: false });
    }

    const { data: worlds, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      console.error('open-worlds list error:', error);
      return errorResponse('Failed to fetch open worlds', 500);
    }

    const ownerIds = Array.from(new Set((worlds || []).map((w) => w.owner_agent_id).filter(Boolean)));
    const ownerMap = new Map<string, string>();

    if (ownerIds.length > 0) {
      const { data: owners } = await supabase
        .from('agents')
        .select('id, name')
        .in('id', ownerIds as string[]);
      (owners || []).forEach((o) => ownerMap.set(o.id, o.name));
    }

    const summaries = (worlds || []).map((w) => toSummary(w as unknown as Record<string, unknown>, ownerMap.get(w.owner_agent_id) || 'Unknown'));

    return jsonResponse({
      success: true,
      data: {
        worlds: summaries,
        total: count || summaries.length,
        sort,
        q,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('open-worlds list exception:', error);
    return errorResponse('Internal server error', 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';

    if (rawName.length < 3 || rawName.length > 64) {
      return errorResponse('World name must be 3-64 characters', 400);
    }

    const seed = Number.isInteger(body?.seed) ? Number(body.seed) : Math.floor(Math.random() * 2_147_483_647);
    const theme = normalizeTheme(body?.theme);

    const baseSlug = slugify(rawName);
    const slug = await resolveUniqueSlug(baseSlug);

    const supabase = createServerClient();

    const { data: world, error } = await supabase
      .from('open_worlds')
      .insert({
        slug,
        name: rawName,
        owner_agent_id: auth.agent.id,
        seed,
        world_size: 500,
        theme,
        status: 'queued',
      })
      .select('*')
      .single();

    if (error || !world) {
      console.error('open-world create error:', error);
      return errorResponse('Failed to create open world', 500);
    }

    const { data: job, error: jobError } = await supabase
      .from('open_world_creation_jobs')
      .insert({
        world_id: world.id,
        status: 'queued',
      })
      .select('id, created_at')
      .single();

    if (jobError) {
      console.error('open-world queue job error:', jobError);
      return errorResponse('Failed to enqueue world creation', 500);
    }

    const { count: queuePositionRaw } = await supabase
      .from('open_world_creation_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'queued')
      .lte('created_at', job.created_at);

    const summary = toSummary(world as unknown as Record<string, unknown>, auth.agent.name);

    return jsonResponse(
      {
        success: true,
        data: {
          world: summary,
          queue_position: queuePositionRaw || 1,
          message: 'World queued for creation',
        },
      },
      201
    );
  } catch (error) {
    console.error('open-world create exception:', error);
    return errorResponse('Internal server error', 500);
  }
}
