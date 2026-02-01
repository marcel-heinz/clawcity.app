import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

// DELETE - Cancel your own market order (can be done from anywhere)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  // Authentication
  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const { id: orderId } = await params;
    const agent = auth.agent;
    const supabase = createServerClient();

    if (!orderId) {
      return errorResponse('Order ID is required');
    }

    // Fetch the order
    const { data: order, error: orderError } = await supabase
      .from('market_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return errorResponse('Order not found');
    }

    // Must be the order owner
    if (order.agent_id !== agent.id) {
      return errorResponse('You can only cancel your own orders');
    }

    // Must be open status
    if (order.status !== 'open') {
      return errorResponse(`Order is already ${order.status}`);
    }

    // Calculate unfilled offer amount to refund
    const unfilledOfferAmount = order.offer_amount - order.filled_amount;

    // Update order status
    await supabase
      .from('market_orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId);

    // Refund reserved offer resources
    if (unfilledOfferAmount > 0) {
      const currentResource = agent[order.offer_resource as keyof typeof agent] as number || 0;
      await supabase
        .from('agents')
        .update({ [order.offer_resource]: currentResource + unfilledOfferAmount })
        .eq('id', agent.id);
    }

    // Log event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'trade',
      data: {
        action: 'market_order_cancelled',
        offer_resource: order.offer_resource,
        request_resource: order.request_resource,
        original_offer: order.offer_amount,
        filled_amount: order.filled_amount,
        refunded: unfilledOfferAmount,
        order_id: orderId,
      },
      location: { x: agent.x, y: agent.y },
    });

    return jsonResponse({
      success: true,
      data: {
        message: 'Order cancelled',
        order_id: orderId,
        refunded: `${unfilledOfferAmount} ${order.offer_resource}`,
        filled_before_cancel: order.filled_amount,
      },
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// GET - Get a specific order by ID (public)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const { id: orderId } = await params;
    const supabase = createServerClient();

    const { data: order, error } = await supabase
      .from('market_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return errorResponse('Order not found', 404);
    }

    // Get agent name
    const { data: agent } = await supabase
      .from('agents')
      .select('name')
      .eq('id', order.agent_id)
      .single();

    const remainingOffer = order.offer_amount - order.filled_amount;
    const fillRatio = remainingOffer / order.offer_amount;
    const remainingRequest = Math.ceil(order.request_amount * fillRatio);

    return jsonResponse({
      success: true,
      data: {
        ...order,
        agent_name: agent?.name || 'Unknown',
        remaining_offer: remainingOffer,
        remaining_request: remainingRequest,
        exchange_rate: order.request_amount / order.offer_amount,
      },
    });
  } catch (error) {
    console.error('Get order error:', error);
    return errorResponse('Internal server error', 500);
  }
}
