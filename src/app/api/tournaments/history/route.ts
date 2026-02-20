import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { HallOfFameEntry, TournamentParticipationSnapshot } from '@/lib/tournament-types';

const PARTICIPATION_SETTING_KEYS = [
  'claw_credit_participation_reward',
  'claw_credit_participation_min_moved_tiles',
] as const;

type ParticipationSettingKey = (typeof PARTICIPATION_SETTING_KEYS)[number];

function toInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return fallback;
}

/**
 * GET /api/tournaments/history
 * Returns Claw Credits Hall of Fame + participation mode summary
 */
export async function GET() {
  if (!isSupabaseConfigured) {
    return jsonResponse({
      success: true,
      data: {
        currency: {
          id: 'claw_credits',
          name: 'Claw Credits',
        },
        hall_of_fame: [],
        participation_mode: null,
      },
    });
  }

  try {
    const supabase = createServerClient();

    const [hallOfFameResult, settingsResult, latestEndedTournamentResult, startedWeekResult] = await Promise.all([
      supabase
        .from('claw_credit_leaderboard')
        .select(
          'agent_id, agent_name, claw_credits, lifetime_earned, lifetime_spent, gold_medals, silver_medals, bronze_medals',
        )
        .order('claw_credits', { ascending: false })
        .order('lifetime_earned', { ascending: false }),
      supabase
        .from('game_settings')
        .select('key, value')
        .in('key', [...PARTICIPATION_SETTING_KEYS]),
      supabase
        .from('tournaments')
        .select('id, name, week_number, ends_at')
        .eq('status', 'ended')
        .order('ends_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc('current_started_tournament_week'),
    ]);

    if (hallOfFameResult.error) {
      console.error('Error fetching claw credit hall of fame:', hallOfFameResult.error);
    }

    if (settingsResult.error) {
      console.error('Error fetching participation settings:', settingsResult.error);
    }

    if (latestEndedTournamentResult.error) {
      console.error('Error fetching latest ended tournament:', latestEndedTournamentResult.error);
    }

    const startedWeek = toInt(startedWeekResult.data, 0);

    const hallOfFameBase = (hallOfFameResult.data || [])
      .map((entry) => {
        const gold = toInt(entry.gold_medals, 0);
        const silver = toInt(entry.silver_medals, 0);
        const bronze = toInt(entry.bronze_medals, 0);
        return {
          agent_id: entry.agent_id,
          agent_name: entry.agent_name,
          claw_credits: toInt(entry.claw_credits, 0),
          lifetime_earned: toInt(entry.lifetime_earned, 0),
          lifetime_spent: toInt(entry.lifetime_spent, 0),
          gold_medals: gold,
          silver_medals: silver,
          bronze_medals: bronze,
          total_podiums: gold + silver + bronze,
        };
      });

    let claimableMap = new Map<string, number>();
    const hallOfFameAgentIds = [...new Set(hallOfFameBase.map((entry) => entry.agent_id))];
    if (hallOfFameAgentIds.length > 0) {
      const { data: claimableRows, error: claimableError } = await supabase
        .from('claw_credit_rewards')
        .select('agent_id, amount')
        .in('agent_id', hallOfFameAgentIds)
        .is('claimed_at', null)
        .lte('unlock_week_number', startedWeek);

      if (claimableError) {
        console.error('Error fetching claimable hall-of-fame rewards:', claimableError);
      } else {
        claimableMap = new Map<string, number>();
        for (const row of claimableRows || []) {
          const amount = toInt(row.amount, 0);
          claimableMap.set(row.agent_id, (claimableMap.get(row.agent_id) || 0) + amount);
        }
      }
    }

    const hallOfFame = hallOfFameBase
      .map((entry) => {
        const claimable = claimableMap.get(entry.agent_id) || 0;
        return {
          ...entry,
          claimable_claw_credits: claimable,
          total_available_claw_credits: entry.claw_credits + claimable,
        } satisfies HallOfFameEntry;
      })
      .filter(
        (entry) =>
          entry.claw_credits > 0 ||
          entry.claimable_claw_credits > 0 ||
          entry.total_podiums > 0,
      )
      .sort(
        (a, b) =>
          b.total_available_claw_credits - a.total_available_claw_credits ||
          b.claw_credits - a.claw_credits ||
          b.gold_medals - a.gold_medals ||
          b.silver_medals - a.silver_medals ||
          b.bronze_medals - a.bronze_medals ||
          a.agent_name.localeCompare(b.agent_name),
      );

    const settingMap = new Map<ParticipationSettingKey, number>();
    for (const row of settingsResult.data || []) {
      if (!PARTICIPATION_SETTING_KEYS.includes(row.key as ParticipationSettingKey)) continue;
      settingMap.set(row.key as ParticipationSettingKey, toInt(row.value, 0));
    }

    const minMovedTiles = settingMap.get('claw_credit_participation_min_moved_tiles') ?? 3;
    const participationReward = settingMap.get('claw_credit_participation_reward') ?? 100;

    let participationMode: TournamentParticipationSnapshot | null = null;
    const latestEndedTournament = latestEndedTournamentResult.data;

    if (latestEndedTournament) {
      const { data: participationRows, error: participationError } = await supabase
        .from('tournament_participation')
        .select('agent_id, final_rank, moved_tiles, qualified, reward_amount')
        .eq('tournament_id', latestEndedTournament.id)
        .order('final_rank', { ascending: true });

      if (participationError) {
        console.error('Error fetching tournament participation summary:', participationError);
      }

      const rows = participationRows || [];
      const participantCount = rows.length;
      const qualifiedCount = rows.filter((row) => row.qualified === true).length;
      const qualificationRate =
        participantCount > 0 ? Math.round((qualifiedCount / participantCount) * 100) : 0;

      const agentIds = [...new Set(rows.map((row) => row.agent_id))];
      let agentNameMap = new Map<string, string>();
      if (agentIds.length > 0) {
        const { data: agents, error: agentsError } = await supabase
          .from('agents')
          .select('id, name')
          .in('id', agentIds);

        if (agentsError) {
          console.error('Error fetching participation agent names:', agentsError);
        } else {
          agentNameMap = new Map((agents || []).map((agent) => [agent.id, agent.name]));
        }
      }

      const topQualifiers = rows
        .filter((row) => row.qualified === true)
        .sort((a, b) => a.final_rank - b.final_rank)
        .slice(0, 20)
        .map((row) => ({
          agent_id: row.agent_id,
          agent_name: agentNameMap.get(row.agent_id) || 'Unknown',
          final_rank: toInt(row.final_rank, 0),
          moved_tiles: toInt(row.moved_tiles, 0),
          qualified: row.qualified === true,
          reward_amount: toInt(row.reward_amount, participationReward),
        }));

      participationMode = {
        tournament_id: latestEndedTournament.id,
        tournament_name: latestEndedTournament.name,
        week_number: toInt(latestEndedTournament.week_number, 0),
        participant_count: participantCount,
        qualified_count: qualifiedCount,
        qualification_rate: qualificationRate,
        top_qualifiers: topQualifiers,
        rules: {
          rank_requirement: 'rank >= 4',
          min_moved_tiles: minMovedTiles,
          reward_amount: participationReward,
        },
      };
    }

    return jsonResponse({
      success: true,
      data: {
        currency: {
          id: 'claw_credits',
          name: 'Claw Credits',
        },
        hall_of_fame: hallOfFame,
        participation_mode: participationMode,
      },
    });
  } catch (error) {
    console.error('Tournament history error:', error);
    return errorResponse('Internal server error', 500);
  }
}
