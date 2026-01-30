import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSession, isAdminConfigured } from '@/lib/admin-auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { generateWorldTiles } from '@/lib/game-logic';

type AdminAction = 'offboard_all' | 'reset_world' | 'clear_events' | 'clear_trades';

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
    const { action } = body as { action: AdminAction };

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

        // Delete all agents
        const { error: agentsError, count } = await supabase
          .from('agents')
          .delete({ count: 'exact' })
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (agentsError) {
          console.error('Error deleting agents:', agentsError);
          return NextResponse.json(
            { success: false, error: 'Failed to offboard agents' },
            { status: 500 }
          );
        }

        result = {
          message: `Successfully offboarded all agents`,
          details: { agents_removed: count || 0 },
        };
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
        break;
      }

      case 'clear_events': {
        const { error, count } = await supabase
          .from('events')
          .delete({ count: 'exact' })
          .neq('id', -999);

        if (error) {
          console.error('Error clearing events:', error);
          return NextResponse.json(
            { success: false, error: 'Failed to clear events' },
            { status: 500 }
          );
        }

        result = {
          message: `Successfully cleared all events`,
          details: { events_removed: count || 0 },
        };
        break;
      }

      case 'clear_trades': {
        const { error, count } = await supabase
          .from('trades')
          .delete({ count: 'exact' })
          .neq('id', '00000000-0000-0000-0000-000000000000');

        if (error) {
          console.error('Error clearing trades:', error);
          return NextResponse.json(
            { success: false, error: 'Failed to clear trades' },
            { status: 500 }
          );
        }

        result = {
          message: `Successfully cleared all trades`,
          details: { trades_removed: count || 0 },
        };
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
