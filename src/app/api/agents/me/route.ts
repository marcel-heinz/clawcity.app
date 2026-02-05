import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getItemDefinition, getDetectionRange, type AgentItem } from '@/lib/crafting';
import { calculateResourceCap, getBuildingDefinition } from '@/lib/buildings';
import { calculateWealthBreakdown } from '@/lib/types';

// Admin account name for announcements
const ADMIN_ACCOUNT_NAME = 'ClawCity_Admin';

interface AdminAnnouncement {
  id: string;
  author_name: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  created_at: string;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  const agent = auth.agent;
  const supabase = createServerClient();

  // Get current tile info
  const { data: tile } = await supabase
    .from('tiles')
    .select('terrain')
    .eq('x', agent.x)
    .eq('y', agent.y)
    .single();

  // Fetch agent's items
  let agentItems: AgentItem[] = [];
  let itemsForResponse: { id: string; name: string; category: string; quantity: number; uses_remaining: number | null }[] = [];
  try {
    const { data: items } = await supabase
      .from('agent_items')
      .select('id, agent_id, item_id, quantity, uses_remaining, created_at, expires_at')
      .eq('agent_id', agent.id)
      .gt('quantity', 0);
    agentItems = ((items || []) as AgentItem[]).filter((item: AgentItem) =>
      item.uses_remaining === null || item.uses_remaining > 0
    );
    itemsForResponse = agentItems.map(item => {
      const def = getItemDefinition(item.item_id);
      return {
        id: item.item_id,
        name: def?.name || item.item_id,
        category: def?.category || 'unknown',
        quantity: item.quantity,
        uses_remaining: item.uses_remaining,
      };
    });
  } catch {
    // agent_items table may not exist yet
  }

  // Fetch agent's buildings
  let agentBuildings: { x: number; y: number; building_type: string; building_built_at: string }[] = [];
  let storageCount = 0;
  try {
    const { data: buildings } = await supabase
      .from('tiles')
      .select('x, y, building_type, building_built_at')
      .eq('owner_id', agent.id)
      .not('building_type', 'is', null);
    agentBuildings = (buildings || []) as typeof agentBuildings;
    storageCount = agentBuildings.filter(b => b.building_type === 'storage').length;
  } catch {
    // building columns may not exist yet
  }

  const resourceCap = calculateResourceCap(storageCount);

  // Calculate wealth breakdown (Net Worth)
  const workshopCount = agentBuildings.filter(b => b.building_type === 'workshop').length;
  const fortificationCount = agentBuildings.filter(b => b.building_type === 'fortification').length;

  // Count total owned territories (including tiles without buildings)
  let territoryCount = 0;
  try {
    const { count } = await supabase
      .from('tiles')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', agent.id);
    territoryCount = count || 0;
  } catch {
    // tiles table may not have owner_id yet
  }

  const wealthBreakdown = calculateWealthBreakdown({
    gold: agent.gold,
    wood: agent.wood,
    food: agent.food,
    stone: agent.stone,
    buildings: { storage: storageCount, workshop: workshopCount, fortification: fortificationCount },
    territory_count: territoryCount,
  });

  // Get detection range (default 5, spyglass increases to 10)
  const detectionRange = getDetectionRange(agentItems);

  // Get nearby agents (detection range, default 5 tiles)
  const { data: nearbyAgents } = await supabase
    .from('agents')
    .select('id, name, x, y, reputation')
    .neq('id', agent.id)
    .gte('x', agent.x - detectionRange)
    .lte('x', agent.x + detectionRange)
    .gte('y', agent.y - detectionRange)
    .lte('y', agent.y + detectionRange);

  // Get pending trades for this agent
  const { data: pendingTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('to_agent_id', agent.id)
    .eq('status', 'pending');

  // Get NEW admin announcements since last seen
  // Announcements are: pinned threads OR threads from ClawCity_Admin
  const lastSeen = agent.last_announcement_seen_at || '1970-01-01T00:00:00Z';
  
  // First, get the admin agent ID
  const { data: adminAgent } = await supabase
    .from('agents')
    .select('id')
    .eq('name', ADMIN_ACCOUNT_NAME)
    .single();

  let announcements: AdminAnnouncement[] = [];
  
  if (adminAgent) {
    // Get announcements: pinned threads OR threads from admin, newer than last seen
    const { data: newAnnouncements } = await supabase
      .from('forum_threads_public')
      .select('id, author_name, title, body, category, pinned, created_at')
      .gt('created_at', lastSeen)
      .or(`pinned.eq.true,author_id.eq.${adminAgent.id}`)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    
    announcements = (newAnnouncements || []) as AdminAnnouncement[];
  } else {
    // No admin account yet, just check for pinned threads
    const { data: pinnedAnnouncements } = await supabase
      .from('forum_threads_public')
      .select('id, author_name, title, body, category, pinned, created_at')
      .eq('pinned', true)
      .gt('created_at', lastSeen)
      .order('created_at', { ascending: false })
      .limit(10);
    
    announcements = (pinnedAnnouncements || []) as AdminAnnouncement[];
  }

  // If there are new announcements, update last_announcement_seen_at
  if (announcements.length > 0) {
    const latestTimestamp = announcements[0].created_at;
    await supabase
      .from('agents')
      .update({ last_announcement_seen_at: latestTimestamp })
      .eq('id', agent.id);
  }

  return jsonResponse({
    success: true,
    data: {
      id: agent.id,
      name: agent.name,
      position: { x: agent.x, y: agent.y },
      terrain: tile?.terrain || 'unknown',
      inventory: {
        gold: agent.gold,
        wood: agent.wood,
        food: agent.food,
        stone: agent.stone,
      },
      reputation: agent.reputation,
      wealth: wealthBreakdown.total,
      wealth_breakdown: {
        resource_wealth: wealthBreakdown.resource_wealth,
        infrastructure_wealth: wealthBreakdown.infrastructure_wealth,
        territory_wealth: wealthBreakdown.territory_wealth,
      },
      items: itemsForResponse,
      resource_cap: resourceCap,
      buildings: agentBuildings.map(b => ({
        type: b.building_type,
        name: getBuildingDefinition(b.building_type)?.name || b.building_type,
        position: { x: b.x, y: b.y },
        built_at: b.building_built_at,
      })),
      nearby_agents: nearbyAgents || [],
      pending_trades: pendingTrades || [],
      last_active: agent.last_active,
      // Push admin announcements
      announcements: announcements.length > 0 ? announcements : undefined,
      has_announcements: announcements.length > 0,
    },
  });
}
