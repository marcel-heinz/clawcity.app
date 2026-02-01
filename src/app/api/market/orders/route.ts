import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { 
  MarketOrder, 
  MarketResource,
  ALL_RESOURCES,
  MAX_OPEN_ORDERS_PER_AGENT,
  ORDER_EXPIRY_HOURS
} from '@/lib/types';
import { withAnnouncements } from '@/lib/announcements';

// GET - List open market orders (public, no auth required)
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const supabase = createServerClient();
    const url = new URL(request.url);
    
    // Query parameters
    const offerResource = url.searchParams.get('offer') as MarketResource | null;
    const requestResource = url.searchParams.get('request') as MarketResource | null;
    const agentId = url.searchParams.get('agent_id');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

    // Build query
    let query = supabase
      .from('market_orders')
      .select(`
        id,
        agent_id,
        offer_resource,
        offer_amount,
        request_resource,
        request_amount,
        filled_amount,
        status,
        created_at,
        updated_at,
        expires_at
      `)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(limit);

    // Apply filters
    if (offerResource && ALL_RESOURCES.includes(offerResource)) {
      query = query.eq('offer_resource', offerResource);
    }
    if (requestResource && ALL_RESOURCES.includes(requestResource)) {
      query = query.eq('request_resource', requestResource);
    }
    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('Error fetching market orders:', error);
      return errorResponse('Failed to fetch orders', 500);
    }

    // Get agent names for the orders
    const agentIds = [...new Set(orders?.map(o => o.agent_id) || [])];
    const { data: agents } = await supabase
      .from('agents')
      .select('id, name')
      .in('id', agentIds);

    const agentMap = new Map(agents?.map(a => [a.id, a.name]) || []);

    // Enrich orders with computed fields
    const enrichedOrders: MarketOrder[] = (orders || []).map(order => {
      const remainingOffer = order.offer_amount - order.filled_amount;
      const fillRatio = remainingOffer / order.offer_amount;
      const remainingRequest = Math.ceil(order.request_amount * fillRatio);
      
      return {
        ...order,
        agent_name: agentMap.get(order.agent_id) || 'Unknown',
        remaining_offer: remainingOffer,
        remaining_request: remainingRequest,
        exchange_rate: order.request_amount / order.offer_amount,
      };
    });

    // Group by trading pair for easier consumption
    const byPair: Record<string, MarketOrder[]> = {};
    for (const order of enrichedOrders) {
      const pairKey = `${order.offer_resource}→${order.request_resource}`;
      if (!byPair[pairKey]) {
        byPair[pairKey] = [];
      }
      byPair[pairKey].push(order);
    }

    // Sort each pair by best rate (lowest request per offer = best deal for filler)
    for (const pair of Object.keys(byPair)) {
      byPair[pair].sort((a, b) => (a.exchange_rate || 0) - (b.exchange_rate || 0));
    }

    return jsonResponse({
      success: true,
      data: {
        orders: enrichedOrders,
        by_pair: byPair,
        total: enrichedOrders.length,
      },
    });
  } catch (error) {
    console.error('Market orders error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// POST - Create a new market order (requires auth, can be done from anywhere)
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  // Rate limiting
  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(`Rate limit exceeded. Try again in ${retryAfter}s.`, 429);
  }

  // Authentication
  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { offer_resource, offer_amount, request_resource, request_amount } = body;
    const agent = auth.agent;
    const supabase = createServerClient();

    // Validate offer_resource
    if (!offer_resource || !ALL_RESOURCES.includes(offer_resource)) {
      return errorResponse(`offer_resource must be one of: ${ALL_RESOURCES.join(', ')}`);
    }

    // Validate request_resource
    if (!request_resource || !ALL_RESOURCES.includes(request_resource)) {
      return errorResponse(`request_resource must be one of: ${ALL_RESOURCES.join(', ')}`);
    }

    // Cannot trade same resource for itself
    if (offer_resource === request_resource) {
      return errorResponse('Cannot trade a resource for itself');
    }

    // Validate amounts
    const parsedOfferAmount = parseInt(offer_amount);
    if (!parsedOfferAmount || parsedOfferAmount <= 0) {
      return errorResponse('offer_amount must be a positive integer');
    }

    const parsedRequestAmount = parseInt(request_amount);
    if (!parsedRequestAmount || parsedRequestAmount <= 0) {
      return errorResponse('request_amount must be a positive integer');
    }

    // Check max open orders
    const { count: openOrderCount } = await supabase
      .from('market_orders')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agent.id)
      .eq('status', 'open');

    if ((openOrderCount || 0) >= MAX_OPEN_ORDERS_PER_AGENT) {
      return errorResponse(`Maximum ${MAX_OPEN_ORDERS_PER_AGENT} open orders allowed. Cancel some orders first.`);
    }

    // Verify agent has the offered resource
    const agentOfferResource = agent[offer_resource as keyof typeof agent] as number;
    if (agentOfferResource < parsedOfferAmount) {
      return errorResponse(`Insufficient ${offer_resource}. You have ${agentOfferResource}, offering ${parsedOfferAmount}`);
    }

    // Reserve offered resources (deduct from agent)
    await supabase
      .from('agents')
      .update({ [offer_resource]: agentOfferResource - parsedOfferAmount })
      .eq('id', agent.id);

    // Create the order
    const expiresAt = new Date(Date.now() + ORDER_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
    
    const { data: newOrder, error: orderError } = await supabase
      .from('market_orders')
      .insert({
        agent_id: agent.id,
        offer_resource,
        offer_amount: parsedOfferAmount,
        request_resource,
        request_amount: parsedRequestAmount,
        filled_amount: 0,
        status: 'open',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (orderError) {
      console.error('Error creating order:', orderError);
      // Refund reserved resources on failure
      await supabase
        .from('agents')
        .update({ [offer_resource]: agentOfferResource })
        .eq('id', agent.id);
      return errorResponse('Failed to create order', 500);
    }

    // Log event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'trade',
      data: {
        action: 'market_order_created',
        offer_resource,
        offer_amount: parsedOfferAmount,
        request_resource,
        request_amount: parsedRequestAmount,
        exchange_rate: parsedRequestAmount / parsedOfferAmount,
        order_id: newOrder.id,
      },
      location: { x: agent.x, y: agent.y },
    });

    const exchangeRate = parsedRequestAmount / parsedOfferAmount;

    // Include any new announcements in the response
    const responseData = await withAnnouncements(agent, {
      message: `Order created: Offering ${parsedOfferAmount} ${offer_resource} for ${parsedRequestAmount} ${request_resource} (rate: ${exchangeRate.toFixed(2)} ${request_resource}/${offer_resource})`,
      order: {
        ...newOrder,
        agent_name: agent.name,
        remaining_offer: parsedOfferAmount,
        remaining_request: parsedRequestAmount,
        exchange_rate: exchangeRate,
      },
      reserved: `${parsedOfferAmount} ${offer_resource} reserved from inventory`,
    });

    return jsonResponse({
      success: true,
      data: responseData,
    }, 201);
  } catch (error) {
    console.error('Create order error:', error);
    return errorResponse('Internal server error', 500);
  }
}
