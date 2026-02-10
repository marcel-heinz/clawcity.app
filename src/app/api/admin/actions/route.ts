import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSession, isAdminConfigured } from '@/lib/admin-auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { generateWorldTiles } from '@/lib/game-logic';
import { getClientIdentifier } from '@/lib/rate-limit';
import { updateCooldownSetting, CooldownType, DEFAULT_COOLDOWNS } from '@/lib/game-settings';

type AdminAction = 'offboard_all' | 'reset_world' | 'clear_events' | 'clear_trades' | 'update_agent_limit' | 'update_cooldowns' | 'reset_tournament';

/**
 * Log admin action to audit log
 */
async function logAdminAction(
  action: AdminAction,
  request: NextRequest,
  success: boolean,
  details: Record<string, unknown> = {}
) {
  if (!isSupabaseConfigured) return;
  
  try {
    const supabase = createServerClient();
    await supabase.from('admin_audit_log').insert({
      action: `admin_action_${action}`,
      details: { ...details, success },
      ip_address: getClientIdentifier(request),
    });
  } catch (error) {
    console.error('Failed to log admin action:', error);
  }
}

// POST - Execute admin action
export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Admin dashboard not configured' },
      { status: 503 }
    );
  }

  if (!verifyAdminSession(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { success: false, error: 'Database not configured' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { action, value, cooldowns } = body as { 
      action: AdminAction; 
      value?: number;
      cooldowns?: Record<string, number>;
    };

    if (!action) {
      return NextResponse.json(
        { success: false, error: 'Action is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    let result: { message: string; details?: Record<string, unknown> };

    switch (action) {
      case 'offboard_all': {
        // Delete all agents (this will cascade to events and trades via foreign keys)
        // First, clear tiles ownership
        const { error: tilesError } = await supabase
          .from('tiles')
          .update({ owner_id: null, claimed_at: null })
          .not('owner_id', 'is', null);

        if (tilesError) {
          console.error('Error clearing tile ownership:', tilesError);
        }

        // Delete all trades
        const { error: tradesError } = await supabase
          .from('trades')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (tradesError) {
          console.error('Error deleting trades:', tradesError);
        }

        // Delete all events
        const { error: eventsError } = await supabase
          .from('events')
          .delete()
          .neq('id', -999); // Delete all

        if (eventsError) {
          console.error('Error deleting events:', eventsError);
        }

        // Delete all agent claims
        const { error: claimsError } = await supabase
          .from('agent_claims')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');

        if (claimsError) {
          console.error('Error deleting agent claims:', claimsError);
        }

        // Delete all agents
        const { error: agentsError, count } = await supabase
          .from('agents')
          .delete({ count: 'exact' })
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (agentsError) {
          console.error('Error deleting agents:', agentsError);
          await logAdminAction(action, request, false, { error: 'Failed to delete agents' });
          return NextResponse.json(
            { success: false, error: 'Failed to offboard agents' },
            { status: 500 }
          );
        }

        result = {
          message: `Successfully offboarded all agents`,
          details: { agents_removed: count || 0 },
        };
        
        await logAdminAction(action, request, true, result.details);
        break;
      }

      case 'reset_world': {
        // Generate new tiles
        const tiles = generateWorldTiles();

        // Clear existing tiles
        const { error: deleteError } = await supabase
          .from('tiles')
          .delete()
          .neq('x', -999);

        if (deleteError) {
          console.error('Error deleting tiles:', deleteError);
          await logAdminAction(action, request, false, { error: 'Failed to clear tiles' });
          return NextResponse.json(
            { success: false, error: 'Failed to clear tiles' },
            { status: 500 }
          );
        }

        // Insert new tiles in batches
        const batchSize = 500;
        for (let i = 0; i < tiles.length; i += batchSize) {
          const batch = tiles.slice(i, i + batchSize);
          const { error } = await supabase.from('tiles').insert(batch);
          if (error) {
            console.error('Error inserting tiles batch:', error);
            await logAdminAction(action, request, false, { error: 'Failed to seed tiles' });
            return NextResponse.json(
              { success: false, error: 'Failed to seed tiles' },
              { status: 500 }
            );
          }
        }

        result = {
          message: `Successfully reset world`,
          details: { tiles_created: tiles.length },
        };
        
        await logAdminAction(action, request, true, result.details);
        break;
      }

      case 'clear_events': {
        const { error, count } = await supabase
          .from('events')
          .delete({ count: 'exact' })
          .neq('id', -999);

        if (error) {
          console.error('Error clearing events:', error);
          await logAdminAction(action, request, false, { error: 'Failed to clear events' });
          return NextResponse.json(
            { success: false, error: 'Failed to clear events' },
            { status: 500 }
          );
        }

        result = {
          message: `Successfully cleared all events`,
          details: { events_removed: count || 0 },
        };
        
        await logAdminAction(action, request, true, result.details);
        break;
      }

      case 'clear_trades': {
        const { error, count } = await supabase
          .from('trades')
          .delete({ count: 'exact' })
          .neq('id', '00000000-0000-0000-0000-000000000000');

        if (error) {
          console.error('Error clearing trades:', error);
          await logAdminAction(action, request, false, { error: 'Failed to clear trades' });
          return NextResponse.json(
            { success: false, error: 'Failed to clear trades' },
            { status: 500 }
          );
        }

        result = {
          message: `Successfully cleared all trades`,
          details: { trades_removed: count || 0 },
        };
        
        await logAdminAction(action, request, true, result.details);
        break;
      }

      case 'update_agent_limit': {
        // Validate the new limit value
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          return NextResponse.json(
            { success: false, error: 'Agent limit must be a non-negative integer' },
            { status: 400 }
          );
        }

        // Update or insert the agent limit setting
        const { error } = await supabase
          .from('game_settings')
          .upsert(
            { key: 'agent_limit', value: value.toString() },
            { onConflict: 'key' }
          );

        if (error) {
          console.error('Error updating agent limit:', error);
          await logAdminAction(action, request, false, { error: 'Failed to update limit', value });
          return NextResponse.json(
            { success: false, error: 'Failed to update agent limit' },
            { status: 500 }
          );
        }

        result = {
          message: `Successfully updated agent limit to ${value}`,
          details: { new_limit: value },
        };
        
        await logAdminAction(action, request, true, result.details);
        break;
      }

      case 'update_cooldowns': {
        // Validate cooldowns object
        if (!cooldowns || typeof cooldowns !== 'object') {
          return NextResponse.json(
            { success: false, error: 'Cooldowns object is required' },
            { status: 400 }
          );
        }

        const validTypes = Object.keys(DEFAULT_COOLDOWNS) as CooldownType[];
        const updates: { type: CooldownType; value: number }[] = [];
        const errors: string[] = [];

        // Validate all cooldown values
        for (const [type, ms] of Object.entries(cooldowns)) {
          if (!validTypes.includes(type as CooldownType)) {
            errors.push(`Invalid cooldown type: ${type}`);
            continue;
          }
          if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0) {
            errors.push(`${type} must be a non-negative integer (milliseconds)`);
            continue;
          }
          updates.push({ type: type as CooldownType, value: ms });
        }

        if (errors.length > 0) {
          return NextResponse.json(
            { success: false, error: errors.join(', ') },
            { status: 400 }
          );
        }

        // Apply all updates
        const results: { type: string; success: boolean }[] = [];
        for (const update of updates) {
          const success = await updateCooldownSetting(update.type, update.value);
          results.push({ type: update.type, success });
        }

        const allSuccess = results.every(r => r.success);
        const failedUpdates = results.filter(r => !r.success).map(r => r.type);

        if (!allSuccess) {
          await logAdminAction(action, request, false, { 
            error: 'Some updates failed', 
            failed: failedUpdates,
            cooldowns 
          });
          return NextResponse.json(
            { success: false, error: `Failed to update: ${failedUpdates.join(', ')}` },
            { status: 500 }
          );
        }

        result = {
          message: `Successfully updated ${updates.length} cooldown setting(s)`,
          details: { cooldowns },
        };
        
        await logAdminAction(action, request, true, result.details);
        break;
      }

      case 'reset_tournament': {
        // Call the full tournament reset RPC
        const { data: resetCount, error: resetError } = await supabase.rpc('reset_all_agents_for_tournament');

        if (resetError) {
          console.error('Error resetting for tournament:', resetError);
          await logAdminAction(action, request, false, { error: 'Failed to reset agents' });
          return NextResponse.json(
            { success: false, error: 'Failed to reset agents for tournament' },
            { status: 500 }
          );
        }

        // Find the active tournament and re-enroll all agents
        let enrolledCount = 0;
        const { data: activeTournament } = await supabase
          .from('tournaments')
          .select('id')
          .eq('status', 'active')
          .single();

        if (activeTournament) {
          const { data: enrolled, error: enrollError } = await supabase.rpc('auto_enroll_all_agents', {
            p_tournament_id: activeTournament.id,
          });

          if (enrollError) {
            console.error('Error auto-enrolling agents:', enrollError);
          } else {
            enrolledCount = enrolled ?? 0;
          }
        }

        result = {
          message: `Tournament reset complete: ${resetCount ?? 0} agents reset, ${enrolledCount} enrolled`,
          details: {
            agents_reset: resetCount ?? 0,
            agents_enrolled: enrolledCount,
            tournament_id: activeTournament?.id ?? null,
          },
        };

        await logAdminAction(action, request, true, result.details);
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Admin action error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
