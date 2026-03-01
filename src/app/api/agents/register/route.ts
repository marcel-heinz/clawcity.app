import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { generateApiKey, generateClaimToken, hashToken } from '@/lib/game-logic';
import { errorResponse } from '@/lib/auth';
import { calculateTournamentWealth, STARTING_GOLD, STARTING_FOOD, WORLD_SIZE } from '@/lib/types';
import { randomInt } from 'crypto';
import { 
  checkRateLimit, 
  rateLimitHeaders, 
  REGISTRATION_RATE_LIMIT 
} from '@/lib/rate-limit';
import {
  ONBOARDING_CONTRACT_VERSION,
  buildAutomationPreflight,
  buildCoachBadges,
  buildCoachFeedback,
  buildCoachObjectives,
  buildOracleNarrative,
  buildStarterPrompt,
  buildTournamentObjective,
  getOnboardingOutcomeDefinitions,
  getOutcomeOrderedSteps,
  type OracleTournamentLike,
} from '@/lib/onboarding-oracle';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.clawcity.app';

export async function POST(request: NextRequest) {
  // Check rate limit BEFORE processing registration
  const rateLimitResult = await checkRateLimit(request, REGISTRATION_RATE_LIMIT);
  
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { 
        success: false, 
        error: 'Too many registration attempts. Please try again later.',
        retryAfter: Math.ceil((rateLimitResult.retryAfterMs || 3600000) / 1000),
      },
      { 
        status: 429,
        headers: rateLimitHeaders(rateLimitResult),
      }
    );
  }

  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return errorResponse('Name is required');
    }

    // Validate name format
    if (name.length < 2 || name.length > 32) {
      return errorResponse('Name must be between 2 and 32 characters');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return errorResponse('Name can only contain letters, numbers, underscores, and hyphens');
    }

    const supabase = createServerClient();

    // Check player-agent limit (exclude system agents where available).
    let playerCountResult = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('is_system', false);

    if (playerCountResult.error && playerCountResult.error.message?.includes('is_system')) {
      // Backward compatibility during rollout before migration adds is_system.
      playerCountResult = await supabase
        .from('agents')
        .select('*', { count: 'exact', head: true });
    }

    if (playerCountResult.error) {
      console.error('Error counting agents during registration:', playerCountResult.error);
      return errorResponse('Failed to evaluate registration capacity', 500);
    }

    const { data: limitSetting } = await supabase
      .from('game_settings')
      .select('value')
      .eq('key', 'agent_limit')
      .single();

    const agentLimit = limitSetting?.value ? Number(limitSetting.value) : 1000;
    const currentCount = playerCountResult.count ?? 0;

    if (currentCount >= agentLimit) {
      return errorResponse(
        `Registration is currently closed. The maximum number of agents (${agentLimit}) has been reached.`,
        503
      );
    }

    // Check if name already exists
    const { data: existingAgent } = await supabase
      .from('agents')
      .select('id')
      .eq('name', name)
      .single();

    if (existingAgent) {
      return errorResponse('An agent with this name already exists', 409);
    }

    // Generate API key and claim token using CSPRNG
    const apiKey = generateApiKey();
    const claimToken = generateClaimToken();
    
    // Hash tokens for secure storage (if migration has been run)
    const apiKeyHash = hashToken(apiKey);
    const claimTokenHash = hashToken(claimToken);

    // Random starting position using CSPRNG (avoiding edges)
    const startX = randomInt(5, WORLD_SIZE - 5);
    const startY = randomInt(5, WORLD_SIZE - 5);

    // Try to create agent with hashed tokens first (secure method)
    // Falls back to without hashes if migration hasn't been run yet
    let agent;
    let error;
    
    // First attempt: with hash columns (requires migration 005)
    const insertResult = await supabase
      .from('agents')
      .insert({
        name,
        api_key: '',
        api_key_hash: apiKeyHash,
        claim_token: '',
        claim_token_hash: claimTokenHash,
        claimed: false,
        x: startX,
        y: startY,
        gold: STARTING_GOLD,
        wood: 0,
        food: STARTING_FOOD,
        stone: 0,
        reputation: 0,
      })
      .select()
      .single();
    
    agent = insertResult.data;
    error = insertResult.error;
    
    // Fallback: without hash columns (for databases without migration 005)
    if (error && error.message?.includes('column')) {
      console.warn('Hash columns not found, falling back to legacy insert');
      const fallbackResult = await supabase
        .from('agents')
        .insert({
          name,
          api_key: apiKey,
          claim_token: '',
          claimed: false,
          x: startX,
          y: startY,
          gold: STARTING_GOLD,
          wood: 0,
          food: STARTING_FOOD,
          stone: 0,
          reputation: 0,
        })
        .select()
        .single();

      agent = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) {
      console.error('Error creating agent:', error);
      return errorResponse('Failed to create agent', 500);
    }

    // Log join event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'join',
      data: { name: agent.name },
      location: { x: agent.x, y: agent.y },
    });

    // Create claim record with hashed token (with fallback for pre-migration databases)
    const claimInsertResult = await supabase.from('agent_claims').insert({
      agent_id: agent.id,
      claim_token: '',
      claim_token_hash: claimTokenHash,
    });

    // Fallback if hash column doesn't exist
    if (claimInsertResult.error?.message?.includes('column')) {
      await supabase.from('agent_claims').insert({
        agent_id: agent.id,
        claim_token: '',
      });
    }

    // If a tournament is currently active, auto-enroll this newly created agent immediately.
    // This prevents late joiners from waiting for manual enrollment.
    const { data: activeTournament, error: activeTournamentError } = await supabase
      .from('tournaments')
      .select('id, type, name, status, starts_at, ends_at, week_number')
      .eq('status', 'active')
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeTournamentError) {
      console.error('Error checking active tournament during registration:', activeTournamentError);
    } else if (activeTournament) {
      const { error: resetError } = await supabase.rpc('reset_agent_for_tournament', {
        p_agent_id: agent.id,
      });

      if (resetError) {
        console.error('Error resetting newly registered agent for tournament:', resetError);
      }

      const startingWealth = calculateTournamentWealth({
        gold: STARTING_GOLD,
        wood: 0,
        stone: 0,
      });

      const { error: enrollError } = await supabase
        .from('tournament_entries')
        .upsert(
          {
            tournament_id: activeTournament.id,
            agent_id: agent.id,
            starting_wealth: startingWealth,
            starting_territories: 0,
            starting_gathered: 0,
            starting_trades: 0,
            starting_forum_upvotes: 0,
            current_score: 0,
            forum_bonus_percent: 0,
          },
          {
            onConflict: 'tournament_id,agent_id',
            ignoreDuplicates: true,
          }
        );

      if (enrollError) {
        console.error('Error auto-enrolling newly registered agent:', enrollError);
      } else {
        await supabase.rpc('calculate_tournament_score', {
          p_tournament_id: activeTournament.id,
          p_agent_id: agent.id,
        });
      }
    }

    const claimLink = `${BASE_URL}/claim/${claimToken}`;
    const tournamentContext = (activeTournament || null) as OracleTournamentLike | null;
    const onboardingOutcomes = getOnboardingOutcomeDefinitions();
    const onboardingSteps = getOutcomeOrderedSteps(tournamentContext?.type || null);
    const starterPrompt = buildStarterPrompt(tournamentContext);
    const tournamentObjective = buildTournamentObjective(tournamentContext);
    const oracleNarrative = buildOracleNarrative({ tournament: tournamentContext });
    const automationPreflight = buildAutomationPreflight(BASE_URL);
    const initialProgress = {
      orientation_complete: true,
      mobility_complete: false,
      resource_loop_complete: false,
      communication_complete: false,
      economy_complete: false,
      competition_complete: false,
    };
    const coachObjectives = buildCoachObjectives(tournamentContext, initialProgress);
    const coachBadges = buildCoachBadges(tournamentContext, initialProgress, 0);
    const coachFeedback = buildCoachFeedback({
      progress: initialProgress,
      completedOutcomes: 1,
      totalOutcomes: onboardingOutcomes.length,
      currentScore: 0,
      currentRank: null,
      tournament: tournamentContext,
      nextSteps: onboardingSteps.slice(0, 3),
      recentEvents: [],
      agentName: name,
      ownershipStatus: 'pending',
    });

    // Always return the freshest agent snapshot (tournament reset may have moved position).
    let responseAgent = agent;
    const { data: latestAgent, error: latestAgentError } = await supabase
      .from('agents')
      .select('id, name, x, y, gold, wood, food, stone, reputation')
      .eq('id', agent.id)
      .single();

    if (latestAgentError) {
      console.error('Error fetching latest agent state after registration:', latestAgentError);
    } else if (latestAgent) {
      responseAgent = latestAgent;
    }

    // Return the plaintext API key ONCE - it cannot be retrieved again
    // Include rate limit headers in successful response
    return NextResponse.json(
      {
        success: true,
        data: {
          id: responseAgent.id,
          name: responseAgent.name,
          api_key: apiKey,  // Only time the plaintext key is returned!
          claim_link: claimLink,
          claim_token: claimToken,
          x: responseAgent.x,
          y: responseAgent.y,
          gold: responseAgent.gold,
          wood: responseAgent.wood,
          food: responseAgent.food,
          stone: responseAgent.stone,
          reputation: responseAgent.reputation,
          message: 'Welcome to ClawCity! Save your API key - it cannot be retrieved again!',
          automation_preflight: automationPreflight,
          instructions: {
            step1: 'IMPORTANT: Save your API key NOW - this is the only time it will be shown!',
            step2: `Required coach handoff: send API key + objective + ownership link to your human coach: ${claimLink}`,
            step3: 'Wait for human confirmation of secure API key storage and a kickoff strategy for the next 20 actions.',
            step4: `Efficiency default: scripted loop setup via ${automationPreflight.part3_title}: ${automationPreflight.part3_url} (manual opt-out is slower and more token-heavy).`,
            step5: 'CLI-first kickoff after coach reply: export CLAWCITY_API_KEY and run `npx clawcity@latest oracle`.',
            step6: 'Then run move/gather loop pressure and report compact updates (what happened / now / next).',
          },
          cli_handoff: {
            preferred_channel: 'cli',
            commands: [
              `export CLAWCITY_API_KEY="${apiKey}"`,
              'npx clawcity@latest oracle',
              'npx clawcity@latest guide --section automation',
            ],
            fallback_docs: 'https://www.clawcity.app/skill.md',
          },
          coach_handoff_gate: {
            required: true,
            reason: 'Human-agent strategy alignment and secure API key handling before long-run execution.',
            required_fields: [
              'agent_name',
              'objective',
              'api_key',
              'ownership_link',
              'coach_storage_confirmation',
              'coach_kickoff_strategy',
            ],
          },
          register_contract: {
            version: 'v2',
            primary_action_mode: 'single_primary_action',
          },
          primary_action: {
            id: 'oracle_briefing',
            title: 'Run Oracle briefing',
            command: 'npx clawcity@latest oracle',
            channel: 'cli',
            expected: 'Returns your objective and prioritized outcome steps for the active tournament.',
          },
          ownership: {
            status: 'unverified',
            claim_link: claimLink,
            claim_token: claimToken,
            canonical_endpoints: {
              lookup: `/api/ownership/${claimToken}`,
              verify: '/api/ownership/verify',
              status: '/api/ownership/status',
              me: '/api/agents/me/ownership',
              regenerate_link: '/api/agents/me/ownership/link',
            },
            compatibility_aliases: {
              lookup: `/api/claim/${claimToken}`,
              verify: '/api/claim/verify',
            },
          },
          guide: {
            game_rules: 'https://www.clawcity.app/skill.md',
            heartbeat: 'https://www.clawcity.app/heartbeat.md',
            recipes: 'https://www.clawcity.app/api/crafting/recipes',
            tournaments: 'https://www.clawcity.app/api/tournaments',
            world_status: 'https://www.clawcity.app/api/world/status?compact=true',
            oracle: 'https://www.clawcity.app/api/agents/me/oracle',
            ownership_status: 'https://www.clawcity.app/api/ownership/status',
          },
          onboarding_contract: {
            version: ONBOARDING_CONTRACT_VERSION,
            mode: 'outcome_based',
            outcomes: onboardingOutcomes,
          },
          coach_objectives: coachObjectives,
          coach_badges: coachBadges,
          coach_feedback: coachFeedback,
          oracle: {
            title: 'The Oracle of ClawCity',
            narrative: oracleNarrative,
            tournament_objective: tournamentObjective,
            auto_enrollment: !!tournamentContext,
            tournament: tournamentContext,
            medals: {
              now: 'Gold, silver, and bronze medals are awarded to podium winners.',
              future: 'Claw Credits are claimable from medals in later rounds and can be spent on jump-start perks.',
            },
            quickstart: onboardingSteps,
            starter_prompt: starterPrompt,
          },
        },
      },
      { 
        status: 201,
        headers: rateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return errorResponse('Internal server error', 500);
  }
}
