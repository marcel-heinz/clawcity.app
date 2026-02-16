import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { errorResponse, jsonResponse } from '@/lib/auth';
import { generateWorldTilesWithSeed } from '@/lib/game-logic';

interface QueuedJob {
  id: string;
  world_id: string;
  attempts: number;
}

function toIntSetting(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

async function ensureOwnerState(worldId: string, ownerAgentId: string) {
  const supabase = createServerClient();

  const { data: existing } = await supabase
    .from('open_world_agent_state')
    .select('agent_id')
    .eq('world_id', worldId)
    .eq('agent_id', ownerAgentId)
    .maybeSingle();

  if (existing) return;

  const { data: owner } = await supabase
    .from('agents')
    .select('*')
    .eq('id', ownerAgentId)
    .single();

  if (!owner) return;

  await supabase.from('open_world_agent_state').insert({
    world_id: worldId,
    agent_id: owner.id,
    x: owner.x,
    y: owner.y,
    gold: owner.gold,
    wood: owner.wood,
    food: owner.food,
    stone: owner.stone,
    reputation: owner.reputation,
    claimed: owner.claimed || false,
    claimed_by_twitter: owner.claimed_by_twitter || null,
    avatar: owner.avatar || {},
    last_active: owner.last_active,
    last_move_at: owner.last_move_at || null,
    last_gather_at: owner.last_gather_at || null,
    last_trade_at: owner.last_trade_at || null,
    last_forum_thread_at: owner.last_forum_thread_at || null,
    last_forum_post_at: owner.last_forum_post_at || null,
    total_gathered_gold: owner.total_gathered_gold || 0,
    total_gathered_wood: owner.total_gathered_wood || 0,
    total_gathered_food: owner.total_gathered_food || 0,
    total_gathered_stone: owner.total_gathered_stone || 0,
    last_food_upkeep_at: owner.last_food_upkeep_at || null,
    food_depleted_at: owner.food_depleted_at || null,
    last_announcement_seen_at: owner.last_announcement_seen_at || null,
    last_gather_x: owner.last_gather_x || null,
    last_gather_y: owner.last_gather_y || null,
    consecutive_same_tile: owner.consecutive_same_tile || 0,
    last_craft_at: owner.last_craft_at || null,
    last_build_at: owner.last_build_at || null,
  });

  await supabase.from('open_world_memberships').upsert({
    world_id: worldId,
    agent_id: owner.id,
    first_joined_at: new Date().toISOString(),
    last_joined_at: new Date().toISOString(),
    visits: 1,
  });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  try {
    const supabase = createServerClient();

    const { data: settingRows } = await supabase
      .from('game_settings')
      .select('key, value')
      .in('key', ['open_world_creation_concurrency', 'open_world_creation_batch_size']);

    const settingMap = new Map((settingRows || []).map((s) => [s.key, s.value]));
    const concurrency = toIntSetting(settingMap.get('open_world_creation_concurrency'), 1);
    const batchSize = toIntSetting(settingMap.get('open_world_creation_batch_size'), 1000);

    const { count: creatingCount } = await supabase
      .from('open_world_creation_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'creating');

    const capacity = Math.max(0, concurrency - (creatingCount || 0));
    if (capacity <= 0) {
      return jsonResponse({
        success: true,
        data: {
          processed: 0,
          concurrency,
          creating: creatingCount || 0,
          message: 'No capacity available; all workers busy',
        },
      });
    }

    const { data: queuedJobs } = await supabase
      .from('open_world_creation_jobs')
      .select('id, world_id, attempts')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(capacity);

    const jobs = (queuedJobs || []) as QueuedJob[];

    const actions: string[] = [];
    for (const job of jobs) {
      const startIso = new Date().toISOString();

      await supabase
        .from('open_world_creation_jobs')
        .update({
          status: 'creating',
          attempts: (job.attempts || 0) + 1,
          started_at: startIso,
          last_error: null,
        })
        .eq('id', job.id)
        .eq('status', 'queued');

      await supabase
        .from('open_worlds')
        .update({ status: 'creating', last_error: null })
        .eq('id', job.world_id);

      try {
        const { data: world } = await supabase
          .from('open_worlds')
          .select('id, seed, world_size, owner_agent_id, name')
          .eq('id', job.world_id)
          .single();

        if (!world) {
          throw new Error(`World ${job.world_id} not found`);
        }

        await supabase
          .from('open_world_tiles')
          .delete()
          .eq('world_id', world.id)
          .gte('x', 0);

        const tiles = generateWorldTilesWithSeed(world.seed, world.world_size || 500);

        for (let i = 0; i < tiles.length; i += batchSize) {
          const batch = tiles.slice(i, i + batchSize).map((tile) => ({
            world_id: world.id,
            x: tile.x,
            y: tile.y,
            terrain: tile.terrain,
            resources: tile.resources,
          }));

          const { error: insertError } = await supabase
            .from('open_world_tiles')
            .insert(batch);

          if (insertError) {
            throw new Error(`Tile insert failed (${i}-${i + batch.length}): ${insertError.message}`);
          }
        }

        await ensureOwnerState(world.id, world.owner_agent_id);

        const finishIso = new Date().toISOString();
        await supabase
          .from('open_world_creation_jobs')
          .update({
            status: 'completed',
            finished_at: finishIso,
            last_error: null,
          })
          .eq('id', job.id);

        await supabase
          .from('open_worlds')
          .update({ status: 'active', updated_at: finishIso, last_error: null })
          .eq('id', world.id);

        actions.push(`Created world ${world.name} (${world.id}) with ${tiles.length} tiles`);
      } catch (worldError) {
        const message = worldError instanceof Error ? worldError.message : String(worldError);
        const finishIso = new Date().toISOString();

        await supabase
          .from('open_world_creation_jobs')
          .update({
            status: 'error',
            finished_at: finishIso,
            last_error: message,
          })
          .eq('id', job.id);

        await supabase
          .from('open_worlds')
          .update({ status: 'error', last_error: message })
          .eq('id', job.world_id);

        actions.push(`ERROR world ${job.world_id}: ${message}`);
      }
    }

    return jsonResponse({
      success: true,
      data: {
        processed: jobs.length,
        concurrency,
        batch_size: batchSize,
        actions,
      },
    });
  } catch (error) {
    console.error('open-world cron error:', error);
    return errorResponse('Internal server error', 500);
  }
}

export { GET as POST };
