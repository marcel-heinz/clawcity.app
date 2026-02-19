import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';

const CORE_RESOURCES = new Set(['gold', 'wood', 'food', 'stone']);

// POST - Fill a market order (requires being at a market tile)
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
    const { order_id, amount, preview, expect_pay_resource, expect_receive_resource } = body as {
      order_id?: string;
      amount?: number | string;
      preview?: boolean;
      expect_pay_resource?: string;
      expect_receive_resource?: string;
    };
    const agent = auth.agent;
    const supabase = createServerClient();

    // Validate order_id
    if (!order_id) {
      return errorResponse('order_id is required');
    }

    // Check if agent is at a market tile
    const { data: currentTile } = await supabase
      .from('tiles')
      .select('terrain')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    if (currentTile?.terrain !== 'market') {
      return errorResponse(
        'You must be at a MARKET tile to fill orders. Travel to a market first (terrain type: "market").'
      );
    }

    // Fetch the order
    const { data: order, error: orderError } = await supabase
      .from('market_orders')
      .select('*')
      .eq('id', order_id)
      .eq('status', 'open')
      .single();

    if (orderError || !order) {
      return errorResponse('Order not found or already filled/cancelled');
    }

    // Cannot fill your own order
    if (order.agent_id === agent.id) {
      return errorResponse('You cannot fill your own order. Cancel it instead.');
    }

    // Calculate fill amounts
    const remainingOffer = order.offer_amount - order.filled_amount;
    const parsedAmount = amount === undefined || amount === null
      ? null
      : parseInt(String(amount), 10);
    const hasExplicitAmount = amount !== undefined && amount !== null;

    if (hasExplicitAmount && (parsedAmount === null || !Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      return errorResponse('Invalid fill amount');
    }

    // Amount refers to how much of the OFFER the filler wants to take
    const fillOfferAmount = parsedAmount ? Math.min(parsedAmount, remainingOffer) : remainingOffer;

    if (fillOfferAmount <= 0) {
      return errorResponse('Invalid fill amount');
    }

    // Calculate proportional request amount the filler must pay
    const fillRatio = fillOfferAmount / order.offer_amount;
    const fillRequestAmount = Math.ceil(order.request_amount * fillRatio);

    const expectedPay = typeof expect_pay_resource === 'string'
      ? expect_pay_resource.trim().toLowerCase()
      : '';
    const expectedReceive = typeof expect_receive_resource === 'string'
      ? expect_receive_resource.trim().toLowerCase()
      : '';

    if (expectedPay && !CORE_RESOURCES.has(expectedPay)) {
      return errorResponse('expect_pay_resource must be one of: gold, wood, food, stone');
    }
    if (expectedReceive && !CORE_RESOURCES.has(expectedReceive)) {
      return errorResponse('expect_receive_resource must be one of: gold, wood, food, stone');
    }

    const actualPay = String(order.request_resource);
    const actualReceive = String(order.offer_resource);
    if (expectedPay && expectedPay !== actualPay) {
      return errorResponse(
        `Direction mismatch. This fill requires paying ${actualPay} to receive ${actualReceive}. ` +
        `You expected to pay ${expectedPay}.`
      );
    }
    if (expectedReceive && expectedReceive !== actualReceive) {
      return errorResponse(
        `Direction mismatch. This fill requires paying ${actualPay} to receive ${actualReceive}. ` +
        `You expected to receive ${expectedReceive}.`
      );
    }

    // Get the order creator's current info
    const { data: orderCreator } = await supabase
      .from('agents')
      .select('id, name, gold, wood, food, stone, reputation')
      .eq('id', order.agent_id)
      .single();

    if (!orderCreator) {
      return errorResponse('Order creator no longer exists');
    }

    const previewPayload = {
      order_id: order.id,
      order_status: order.status,
      pay: {
        resource: actualPay,
        amount: fillRequestAmount,
      },
      receive: {
        resource: actualReceive,
        amount: fillOfferAmount,
      },
      maker: {
        agent_id: orderCreator.id,
        agent_name: orderCreator.name,
      },
      remaining_after_fill: {
        offer_amount: Math.max(order.offer_amount - (order.filled_amount + fillOfferAmount), 0),
      },
    };

    if (preview) {
      return jsonResponse({
        success: true,
        data: {
          message: `Preview: you will pay ${fillRequestAmount} ${actualPay} and receive ${fillOfferAmount} ${actualReceive}.`,
          preview: previewPayload,
        },
      });
    }

    // Filler must have the REQUEST resource to give to the order creator
    const fillerRequestResource = agent[order.request_resource as keyof typeof agent] as number || 0;
    if (fillerRequestResource < fillRequestAmount) {
      return errorResponse(
        `Insufficient ${order.request_resource}. You have ${fillerRequestResource}, need ${fillRequestAmount}. ` +
        `Fill direction: pay ${fillRequestAmount} ${actualPay} to receive ${fillOfferAmount} ${actualReceive}.`
      );
    }

    // Execute the trade:
    // 1. Filler gives request_resource to order creator
    // 2. Filler receives offer_resource (which was already reserved)
    
    // Update filler (current agent): -request_resource, +offer_resource
    const fillerOfferResource = agent[order.offer_resource as keyof typeof agent] as number || 0;
    await supabase
      .from('agents')
      .update({
        [order.request_resource]: fillerRequestResource - fillRequestAmount,
        [order.offer_resource]: fillerOfferResource + fillOfferAmount,
      })
      .eq('id', agent.id);

    // Update order creator: +request_resource (offer was already deducted when order created)
    const creatorRequestResource = orderCreator[order.request_resource as keyof typeof orderCreator] as number || 0;
    await supabase
      .from('agents')
      .update({
        [order.request_resource]: creatorRequestResource + fillRequestAmount,
      })
      .eq('id', order.agent_id);

    // Update order
    const newFilledAmount = order.filled_amount + fillOfferAmount;
    const newStatus = newFilledAmount >= order.offer_amount ? 'filled' : 'open';

    await supabase
      .from('market_orders')
      .update({
        filled_amount: newFilledAmount,
        status: newStatus,
      })
      .eq('id', order_id);

    // Record transaction
    await supabase.from('market_transactions').insert({
      order_id: order.id,
      order_creator_id: order.agent_id,
      filler_id: agent.id,
      offer_resource: order.offer_resource,
      offer_amount: fillOfferAmount,
      request_resource: order.request_resource,
      request_amount: fillRequestAmount,
    });

    // Log events for both parties
    await supabase.from('events').insert([
      {
        agent_id: agent.id,
        type: 'trade',
        data: {
          action: 'market_fill',
          gave: { [order.request_resource]: fillRequestAmount },
          received: { [order.offer_resource]: fillOfferAmount },
          with_agent: orderCreator.name,
          order_id: order.id,
        },
        location: { x: agent.x, y: agent.y },
      },
      {
        agent_id: order.agent_id,
        type: 'trade',
        data: {
          action: 'market_order_filled',
          gave: { [order.offer_resource]: fillOfferAmount },
          received: { [order.request_resource]: fillRequestAmount },
          filled_by: agent.name,
          order_id: order.id,
          order_status: newStatus,
        },
        location: { x: agent.x, y: agent.y },
      },
    ]);

    // Increase reputation for both parties
    await supabase
      .from('agents')
      .update({ reputation: agent.reputation + 1 })
      .eq('id', agent.id);

    await supabase
      .from('agents')
      .update({ reputation: orderCreator.reputation + 1 })
      .eq('id', orderCreator.id);

    // Include any new announcements in the response
    const responseData = await withAnnouncements(agent, {
      message: `Trade completed! You paid ${fillRequestAmount} ${order.request_resource}, received ${fillOfferAmount} ${order.offer_resource} from ${orderCreator.name}.`,
      transaction: {
        gave: { resource: order.request_resource, amount: fillRequestAmount },
        received: { resource: order.offer_resource, amount: fillOfferAmount },
        with_agent: orderCreator.name,
      },
      fill_preview: previewPayload,
      order_status: newStatus,
      order_remaining_offer: order.offer_amount - newFilledAmount,
    });

    return jsonResponse({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Fill order error:', error);
    return errorResponse('Internal server error', 500);
  }
}
