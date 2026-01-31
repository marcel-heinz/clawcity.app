import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';

/**
 * GET /api/cron/tournaments
 * 
 * Weekly cron job to:
 * 1. Finalize any active tournaments that have ended
 * 2. Activate any upcoming tournaments that should start
 * 3. Create next tournament if none upcoming
 * 
 * Called every Tuesday at 00:00 UTC via Vercel Cron
 */
export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  try {
    const supabase = createServerClient();
    const results: string[] = [];

    // 1. Finalize any active tournaments that have ended
    const { data: endedTournaments } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('status', 'active')
      .lt('ends_at', new Date().toISOString());

    for (const tournament of endedTournaments || []) {
      const { error } = await supabase.rpc('finalize_tournament', {
        p_tournament_id: tournament.id,
      });
      
      if (error) {
        console.error(`Failed to finalize ${tournament.name}:`, error);
        results.push(`ERROR: Failed to finalize ${tournament.name}`);
      } else {
        results.push(`Finalized: ${tournament.name}`);
      }
    }

    // 2. Activate any upcoming tournaments that should start now
    const { data: toActivate } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('status', 'upcoming')
      .lte('starts_at', new Date().toISOString());

    for (const tournament of toActivate || []) {
      const { error } = await supabase
        .from('tournaments')
        .update({ status: 'active' })
        .eq('id', tournament.id);
      
      if (error) {
        console.error(`Failed to activate ${tournament.name}:`, error);
        results.push(`ERROR: Failed to activate ${tournament.name}`);
      } else {
        results.push(`Activated: ${tournament.name}`);
      }
    }

    // 3. Check if we need to create next tournament
    const { data: upcoming } = await supabase
      .from('tournaments')
      .select('id')
      .eq('status', 'upcoming')
      .limit(1);

    if (!upcoming || upcoming.length === 0) {
      // No upcoming tournament, create one for next Tuesday
      const { data: newId, error } = await supabase.rpc('create_next_tournament');
      
      if (error) {
        console.error('Failed to create next tournament:', error);
        results.push('ERROR: Failed to create next tournament');
      } else {
        // Get the created tournament name
        const { data: newTournament } = await supabase
          .from('tournaments')
          .select('name')
          .eq('id', newId)
          .single();
        
        results.push(`Created: ${newTournament?.name || newId}`);
      }
    }

    return jsonResponse({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        actions: results,
      },
    });
  } catch (error) {
    console.error('Cron tournament error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// Also support POST for manual triggers
export { GET as POST };
