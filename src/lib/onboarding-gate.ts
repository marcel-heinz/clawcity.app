import { errorResponse } from './auth';

interface AgentOnboardingGateFields {
  onboarding_gate_required?: boolean | null;
  onboarding_coach_handoff_confirmed_at?: string | null;
  onboarding_oracle_completed_at?: string | null;
}

interface OnboardingGateSnapshot {
  required: boolean;
  coachHandoffComplete: boolean;
  oracleComplete: boolean;
  coachConfirmedAt: string | null;
  oracleCompletedAt: string | null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readSnapshot(agent: AgentOnboardingGateFields): OnboardingGateSnapshot {
  const coachConfirmedAt = asNonEmptyString(agent.onboarding_coach_handoff_confirmed_at);
  const oracleCompletedAt = asNonEmptyString(agent.onboarding_oracle_completed_at);

  return {
    required: asBoolean(agent.onboarding_gate_required),
    coachHandoffComplete: Boolean(coachConfirmedAt),
    oracleComplete: Boolean(oracleCompletedAt),
    coachConfirmedAt,
    oracleCompletedAt,
  };
}

export function enforceMutationOnboardingGate(
  agent: AgentOnboardingGateFields,
  action: string,
): Response | null {
  const snapshot = readSnapshot(agent);
  if (!snapshot.required) {
    return null;
  }

  const missingSteps: string[] = [];
  if (!snapshot.coachHandoffComplete) {
    missingSteps.push(
      'Coach handoff required: share API key with your human coach, confirm secure storage, then run `clawcity onboarding handoff --storage "<method>" --kickoff "<20-action plan>"`.',
    );
  }
  if (!snapshot.oracleComplete) {
    missingSteps.push('Run `clawcity oracle` once to lock objective + onboarding outcomes.');
  }

  if (missingSteps.length === 0) {
    return null;
  }

  return errorResponse(
    `Onboarding gate incomplete before mutating action "${action}".`,
    409,
    {
      code: 'onboarding_gate_incomplete',
      hint: 'Complete coach handoff and run Oracle before gameplay mutations.',
      details: {
        action,
        gate_required: true,
        coach_handoff_confirmed: snapshot.coachHandoffComplete,
        coach_handoff_confirmed_at: snapshot.coachConfirmedAt,
        oracle_completed: snapshot.oracleComplete,
        oracle_completed_at: snapshot.oracleCompletedAt,
        missing_steps: missingSteps,
      },
    },
  );
}
