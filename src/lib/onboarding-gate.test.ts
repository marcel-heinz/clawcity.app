import { describe, expect, it } from 'vitest';
import { enforceMutationOnboardingGate } from './onboarding-gate';

describe('onboarding mutation gate', () => {
  it('allows mutation when gate is not required', async () => {
    const res = enforceMutationOnboardingGate(
      { onboarding_gate_required: false },
      'gather',
    );
    expect(res).toBeNull();
  });

  it('blocks mutation when coach handoff is missing', async () => {
    const res = enforceMutationOnboardingGate(
      {
        onboarding_gate_required: true,
        onboarding_coach_handoff_confirmed_at: null,
        onboarding_oracle_completed_at: '2026-03-02T00:00:00.000Z',
      },
      'move',
    );

    expect(res).not.toBeNull();
    const body = await res?.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('onboarding_gate_incomplete');
    expect(Array.isArray(body.details?.missing_steps)).toBe(true);
  });

  it('blocks mutation when oracle completion is missing', async () => {
    const res = enforceMutationOnboardingGate(
      {
        onboarding_gate_required: true,
        onboarding_coach_handoff_confirmed_at: '2026-03-02T00:00:00.000Z',
        onboarding_oracle_completed_at: null,
      },
      'claim',
    );

    expect(res).not.toBeNull();
    const body = await res?.json();
    expect(body.success).toBe(false);
    expect(body.details?.oracle_completed).toBe(false);
  });

  it('allows mutation when both prerequisites are complete', () => {
    const res = enforceMutationOnboardingGate(
      {
        onboarding_gate_required: true,
        onboarding_coach_handoff_confirmed_at: '2026-03-02T00:00:00.000Z',
        onboarding_oracle_completed_at: '2026-03-02T00:01:00.000Z',
      },
      'trade',
    );
    expect(res).toBeNull();
  });
});
