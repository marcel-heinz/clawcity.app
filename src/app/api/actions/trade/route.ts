import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { hasEnoughResources, areAgentsNearby } from '@/lib/game-logic';
import { getCooldownMs, atomicCooldownCheck } from '@/lib/game-settings';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import {
  gameplayTableName,
  resolveAgentForContext,
  resolveGameplayContext,
  scopeAgentMutation,
  scopeTileQuery,
  scopeWorldQuery,
} from '@/lib/game-context';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Apply rate limiting first (per-IP)
  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(
      `Rate limit exceeded. Try again in ${retryAfter}s.`,
      429
    );
  }

  const auth = await authenticateAgent(request);

  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { action, target, offer, request: tradeRequest, trade_id } = body;

    const supabase = createServerClient();
    const context = await resolveGameplayContext(auth.agent.id);
    const agent = await resolveAgentForContext(auth.agent, context);
    const agentsTable = gameplayTableName('agents', context);
    const tradesTable = gameplayTableName('trades', context);
    const tilesTable = gameplayTableName('tiles', context);
    const eventsTable = gameplayTableName('events', context);

    const addWorld = <T extends Record<string, unknown>>(payload: T): T | (T & { world_id: string }) => {
      if (context.mode === 'open_world' && context.world_id) {
        return { world_id: context.world_id, ...payload };
      }
      return payload;
    };

    // Get dynamic cooldown setting
    const tradeCooldownMs = await getCooldownMs('trade');

    // Accept or reject a trade
    if (action === 'accept' || action === 'reject') {
      if (!trade_id) {
        return errorResponse('trade_id is required for accept/reject');
      }

      let tradeQuery = supabase
        .from(tradesTable)
        .select('*')
        .eq('id', trade_id)
        .eq('to_agent_id', agent.id)
        .eq('status', 'pending');
      tradeQuery = scopeWorldQuery(tradeQuery, context);
      const { data: trade } = await tradeQuery.single();

      if (!trade) {
        return errorResponse('Trade not found or already processed');
      }

      if (action === 'reject') {
        // Reject does NOT have cooldown - allows quick cleanup of spam offers
        let rejectQuery = supabase
          .from(tradesTable)
          .update({ status: 'rejected' })
          .eq('id', trade_id);
        rejectQuery = scopeWorldQuery(rejectQuery, context);
        await rejectQuery;

        return jsonResponse({
          success: true,
          data: { message: 'Trade rejected', context },
        });
      }

      let cooldownTouchedAtomically = false;
      if (context.mode !== 'open_world') {
        // Tournament mode keeps atomic DB cooldown checks as-is
        const cooldownResult = await atomicCooldownCheck(agent.id, 'trade', tradeCooldownMs);

        if (cooldownResult.remainingMs !== undefined && cooldownResult.remainingMs > 0) {
          const waitSeconds = Math.ceil(cooldownResult.remainingMs / 1000);
          return errorResponse(
            `Trade cooldown active. Wait ${waitSeconds}s before accepting another trade.`,
            429
          );
        }

        if (!cooldownResult.success) {
          if (agent.last_trade_at) {
            const lastTrade = new Date(agent.last_trade_at).getTime();
            const elapsed = Date.now() - lastTrade;
            if (elapsed < tradeCooldownMs) {
              const waitSeconds = Math.ceil((tradeCooldownMs - elapsed) / 1000);
              return errorResponse(
                `Trade cooldown active. Wait ${waitSeconds}s before accepting another trade.`,
                429
              );
            }
          }
        } else {
          cooldownTouchedAtomically = true;
        }
      } else if (agent.last_trade_at) {
        const lastTrade = new Date(agent.last_trade_at).getTime();
        const elapsed = Date.now() - lastTrade;
        if (elapsed < tradeCooldownMs) {
          const waitSeconds = Math.ceil((tradeCooldownMs - elapsed) / 1000);
          return errorResponse(
            `Trade cooldown active. Wait ${waitSeconds}s before accepting another trade.`,
            429
          );
        }
      }

      // Accept trade - verify both parties have resources
      let fromAgentName = 'Unknown';
      let fromAgentResources: { gold: number; wood: number; food: number; stone: number; reputation: number } | null = null;

      if (context.mode === 'open_world' && context.world_id) {
        const { data: fromState } = await supabase
          .from('open_world_agent_state')
          .select('gold, wood, food, stone, reputation')
          .eq('world_id', context.world_id)
          .eq('agent_id', trade.from_agent_id)
          .single();

        if (!fromState) {
          return errorResponse('Trade initiator no longer exists in this world');
        }

        const { data: fromBase } = await supabase
          .from('agents')
          .select('name')
          .eq('id', trade.from_agent_id)
          .single();

        fromAgentName = fromBase?.name || fromAgentName;
        fromAgentResources = {
          gold: fromState.gold,
          wood: fromState.wood,
          food: fromState.food,
          stone: fromState.stone,
          reputation: fromState.reputation,
        };
      } else {
        const { data: fromAgent } = await supabase
          .from('agents')
          .select('name, gold, wood, food, stone, reputation')
          .eq('id', trade.from_agent_id)
          .single();

        if (!fromAgent) {
          return errorResponse('Trade initiator no longer exists');
        }

        fromAgentName = fromAgent.name;
        fromAgentResources = {
          gold: fromAgent.gold,
          wood: fromAgent.wood,
          food: fromAgent.food,
          stone: fromAgent.stone,
          reputation: fromAgent.reputation,
        };
      }

      // Check if initiator still has the offered resources
      if (!hasEnoughResources(fromAgentResources, trade.offer)) {
        let expireQuery = supabase
          .from(tradesTable)
          .update({ status: 'expired' })
          .eq('id', trade_id);
        expireQuery = scopeWorldQuery(expireQuery, context);
        await expireQuery;
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

      // Execute trade: initiator side
      let initiatorUpdateQuery = supabase
        .from(agentsTable)
        .update({
          gold: fromAgentResources.gold - (trade.offer.gold || 0) + (trade.request.gold || 0),
          wood: fromAgentResources.wood - (trade.offer.wood || 0) + (trade.request.wood || 0),
          food: fromAgentResources.food - (trade.offer.food || 0) + (trade.request.food || 0),
          stone: fromAgentResources.stone - (trade.offer.stone || 0) + (trade.request.stone || 0),
          reputation: fromAgentResources.reputation + 1,
        });
      initiatorUpdateQuery = scopeAgentMutation(initiatorUpdateQuery, context, trade.from_agent_id);
      await initiatorUpdateQuery;

      // Execute trade: acceptor side
      const acceptorUpdate: Record<string, unknown> = {
        gold: agent.gold - (trade.request.gold || 0) + (trade.offer.gold || 0),
        wood: agent.wood - (trade.request.wood || 0) + (trade.offer.wood || 0),
        food: agent.food - (trade.request.food || 0) + (trade.offer.food || 0),
        stone: agent.stone - (trade.request.stone || 0) + (trade.offer.stone || 0),
        reputation: agent.reputation + 1,
      };

      // Only set cooldown if atomic check didn't do it
      if (!cooldownTouchedAtomically) {
        acceptorUpdate.last_trade_at = new Date().toISOString();
      }

      let acceptorUpdateQuery = supabase
        .from(agentsTable)
        .update(acceptorUpdate);
      acceptorUpdateQuery = scopeAgentMutation(acceptorUpdateQuery, context, agent.id);
      await acceptorUpdateQuery;

      // Update trade status
      let acceptTradeQuery = supabase
        .from(tradesTable)
        .update({ status: 'accepted' })
        .eq('id', trade_id);
      acceptTradeQuery = scopeWorldQuery(acceptTradeQuery, context);
      await acceptTradeQuery;

      // Log trade event
      await supabase.from(eventsTable).insert(
        addWorld({
          agent_id: agent.id,
          type: 'trade',
          data: {
            with_agent_id: trade.from_agent_id,
            with_agent_name: fromAgentName,
            received: trade.offer,
            gave: trade.request,
          },
          location: { x: agent.x, y: agent.y },
        })
      );

      // Include any new announcements in the response
      const acceptResponseData = await withAnnouncements(agent, {
        message: `Trade completed with ${fromAgentName}!`,
        received: trade.offer,
        gave: trade.request,
        context,
      });

      return jsonResponse({
        success: true,
        data: acceptResponseData,
      });
    }

    // Create a new trade offer
    let cooldownTouchedAtomically = false;
    if (context.mode !== 'open_world') {
      // Tournament mode keeps atomic DB cooldown checks as-is
      const cooldownResult = await atomicCooldownCheck(agent.id, 'trade', tradeCooldownMs);

      if (cooldownResult.remainingMs !== undefined && cooldownResult.remainingMs > 0) {
        const waitSeconds = Math.ceil(cooldownResult.remainingMs / 1000);
        return errorResponse(
          `Trade cooldown active. Wait ${waitSeconds}s before creating another trade offer.`,
          429
        );
      }

      if (!cooldownResult.success) {
        if (agent.last_trade_at) {
          const lastTrade = new Date(agent.last_trade_at).getTime();
          const elapsed = Date.now() - lastTrade;
          if (elapsed < tradeCooldownMs) {
            const waitSeconds = Math.ceil((tradeCooldownMs - elapsed) / 1000);
            return errorResponse(
              `Trade cooldown active. Wait ${waitSeconds}s before creating another trade offer.`,
              429
            );
          }
        }
      } else {
        cooldownTouchedAtomically = true;
      }
    } else if (agent.last_trade_at) {
      const lastTrade = new Date(agent.last_trade_at).getTime();
      const elapsed = Date.now() - lastTrade;
      if (elapsed < tradeCooldownMs) {
        const waitSeconds = Math.ceil((tradeCooldownMs - elapsed) / 1000);
        return errorResponse(
          `Trade cooldown active. Wait ${waitSeconds}s before creating another trade offer.`,
          429
        );
      }
    }

    if (!target || !offer || !tradeRequest) {
      return errorResponse('target, offer, and request are required to propose a trade');
    }

    // Find target agent
    const { data: targetBase } = await supabase
      .from('agents')
      .select('id, name')
      .eq('name', target)
      .single();

    if (!targetBase) {
      return errorResponse(`Agent "${target}" not found`);
    }

    if (targetBase.id === agent.id) {
      return errorResponse('You cannot trade with yourself');
    }

    let targetPosition: { x: number; y: number } | null = null;
    if (context.mode === 'open_world' && context.world_id) {
      const { data: targetState } = await supabase
        .from('open_world_agent_state')
        .select('x, y')
        .eq('world_id', context.world_id)
        .eq('agent_id', targetBase.id)
        .single();

      if (!targetState) {
        return errorResponse(`Agent "${target}" is not in this open world`);
      }

      targetPosition = { x: targetState.x, y: targetState.y };
    } else {
      const { data: targetState } = await supabase
        .from('agents')
        .select('x, y')
        .eq('id', targetBase.id)
        .single();

      if (!targetState) {
        return errorResponse(`Agent "${target}" not found`);
      }

      targetPosition = { x: targetState.x, y: targetState.y };
    }

    // Check if agents are nearby (within 5 tiles, or at a market)
    let tileQuery = supabase
      .from(tilesTable)
      .select('terrain');
    tileQuery = scopeTileQuery(tileQuery, context, agent.x, agent.y);
    const { data: currentTile } = await tileQuery.single();

    const atMarket = currentTile?.terrain === 'market';
    const nearby = areAgentsNearby(
      { x: agent.x, y: agent.y },
      { x: targetPosition.x, y: targetPosition.y },
      atMarket ? 50 : 5
    );

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
    const tradePayload: Record<string, unknown> = {
      from_agent_id: agent.id,
      to_agent_id: targetBase.id,
      offer,
      request: tradeRequest,
      status: 'pending',
    };
    if (context.mode === 'open_world' && context.world_id) {
      tradePayload.world_id = context.world_id;
    }

    const { data: newTrade, error: tradeError } = await supabase
      .from(tradesTable)
      .insert(tradePayload)
      .select()
      .single();

    if (tradeError) {
      console.error('Error creating trade:', tradeError);
      return errorResponse('Failed to create trade', 500);
    }

    // Update cooldown timestamp if atomic check didn't do it
    if (!cooldownTouchedAtomically) {
      let cooldownUpdateQuery = supabase
        .from(agentsTable)
        .update({ last_trade_at: new Date().toISOString() });
      cooldownUpdateQuery = scopeAgentMutation(cooldownUpdateQuery, context, agent.id);
      await cooldownUpdateQuery;
    }

    // Include any new announcements in the response
    const createResponseData = await withAnnouncements(agent, {
      message: `Trade offer sent to ${target}`,
      trade_id: newTrade.id,
      offer,
      request: tradeRequest,
      context,
    });

    return jsonResponse({
      success: true,
      data: createResponseData,
    }, 201);
  } catch (error) {
    console.error('Trade error:', error);
    return errorResponse('Internal server error', 500);
  }
}
