import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { hasEnoughResources, areAgentsNearby } from '@/lib/game-logic';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { action, target, offer, request: tradeRequest, trade_id } = body;

    const agent = auth.agent;
    const supabase = createServerClient();

    // Accept or reject a trade
    if (action === 'accept' || action === 'reject') {
      if (!trade_id) {
        return errorResponse('trade_id is required for accept/reject');
      }

      const { data: trade } = await supabase
        .from('trades')
        .select('*')
        .eq('id', trade_id)
        .eq('to_agent_id', agent.id)
        .eq('status', 'pending')
        .single();

      if (!trade) {
        return errorResponse('Trade not found or already processed');
      }

      if (action === 'reject') {
        await supabase
          .from('trades')
          .update({ status: 'rejected' })
          .eq('id', trade_id);

        return jsonResponse({
          success: true,
          data: { message: 'Trade rejected' },
        });
      }

      // Accept trade - verify both parties have resources
      const { data: fromAgent } = await supabase
        .from('agents')
        .select('*')
        .eq('id', trade.from_agent_id)
        .single();

      if (!fromAgent) {
        return errorResponse('Trade initiator no longer exists');
      }

      // Check if initiator still has the offered resources
      if (!hasEnoughResources(fromAgent, trade.offer)) {
        await supabase
          .from('trades')
          .update({ status: 'expired' })
          .eq('id', trade_id);
        return errorResponse('Trade initiator no longer has the offered resources');
      }

      // Check if acceptor has the requested resources
      const agentResources = {
        gold: agent.gold,
        wood: agent.wood,
        food: agent.food,
        stone: agent.stone,
      };
      if (!hasEnoughResources(agentResources, trade.request)) {
        return errorResponse('You do not have enough resources to complete this trade');
      }

      // Execute trade
      // Deduct from initiator, add to acceptor
      await supabase
        .from('agents')
        .update({
          gold: fromAgent.gold - (trade.offer.gold || 0) + (trade.request.gold || 0),
          wood: fromAgent.wood - (trade.offer.wood || 0) + (trade.request.wood || 0),
          food: fromAgent.food - (trade.offer.food || 0) + (trade.request.food || 0),
          stone: fromAgent.stone - (trade.offer.stone || 0) + (trade.request.stone || 0),
        })
        .eq('id', fromAgent.id);

      // Deduct from acceptor, add to acceptor
      await supabase
        .from('agents')
        .update({
          gold: agent.gold - (trade.request.gold || 0) + (trade.offer.gold || 0),
          wood: agent.wood - (trade.request.wood || 0) + (trade.offer.wood || 0),
          food: agent.food - (trade.request.food || 0) + (trade.offer.food || 0),
          stone: agent.stone - (trade.request.stone || 0) + (trade.offer.stone || 0),
        })
        .eq('id', agent.id);

      // Update trade status
      await supabase
        .from('trades')
        .update({ status: 'accepted' })
        .eq('id', trade_id);

      // Increase reputation for both parties
      await supabase
        .from('agents')
        .update({ reputation: fromAgent.reputation + 1 })
        .eq('id', fromAgent.id);

      await supabase
        .from('agents')
        .update({ reputation: agent.reputation + 1 })
        .eq('id', agent.id);

      // Log trade event
      await supabase.from('events').insert({
        agent_id: agent.id,
        type: 'trade',
        data: {
          with_agent_id: fromAgent.id,
          with_agent_name: fromAgent.name,
          received: trade.offer,
          gave: trade.request,
        },
        location: { x: agent.x, y: agent.y },
      });

      return jsonResponse({
        success: true,
        data: {
          message: `Trade completed with ${fromAgent.name}!`,
          received: trade.offer,
          gave: trade.request,
        },
      });
    }

    // Create a new trade offer
    if (!target || !offer || !tradeRequest) {
      return errorResponse('target, offer, and request are required to propose a trade');
    }

    // Find target agent
    const { data: targetAgent } = await supabase
      .from('agents')
      .select('id, name, x, y')
      .eq('name', target)
      .single();

    if (!targetAgent) {
      return errorResponse(`Agent "${target}" not found`);
    }

    if (targetAgent.id === agent.id) {
      return errorResponse('You cannot trade with yourself');
    }

    // Check if agents are nearby (within 5 tiles, or at a market)
    const { data: currentTile } = await supabase
      .from('tiles')
      .select('terrain')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    const atMarket = currentTile?.terrain === 'market';
    const nearby = areAgentsNearby(agent, targetAgent, atMarket ? 50 : 5);

    if (!nearby) {
      return errorResponse(`${target} is too far away to trade with. Move closer or meet at a market.`);
    }

    // Validate offer
    const agentResources = {
      gold: agent.gold,
      wood: agent.wood,
      food: agent.food,
      stone: agent.stone,
    };
    if (!hasEnoughResources(agentResources, offer)) {
      return errorResponse('You do not have enough resources to make this offer');
    }

    // Create trade
    const { data: newTrade, error: tradeError } = await supabase
      .from('trades')
      .insert({
        from_agent_id: agent.id,
        to_agent_id: targetAgent.id,
        offer,
        request: tradeRequest,
        status: 'pending',
      })
      .select()
      .single();

    if (tradeError) {
      console.error('Error creating trade:', tradeError);
      return errorResponse('Failed to create trade', 500);
    }

    return jsonResponse({
      success: true,
      data: {
        message: `Trade offer sent to ${target}`,
        trade_id: newTrade.id,
        offer,
        request: tradeRequest,
      },
    }, 201);
  } catch (error) {
    console.error('Trade error:', error);
    return errorResponse('Internal server error', 500);
  }
}
