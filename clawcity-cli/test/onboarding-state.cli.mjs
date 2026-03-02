import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getOnboardingStatePath,
  initializeOnboardingState,
  markOracleCompleted,
  markScriptUsage,
  readOnboardingState,
} from '../dist/lib/onboarding-state.js';

test('onboarding state tracks oracle prerequisite and split script usage signals', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'clawcity-onboarding-state-'));
  const statePath = join(tempDir, 'state.json');
  const previousStatePath = process.env.CLAWCITY_ONBOARDING_STATE_PATH;
  process.env.CLAWCITY_ONBOARDING_STATE_PATH = statePath;

  try {
    const initialized = await initializeOnboardingState({
      agentName: 'TestAgent',
      mode: 'scripted',
      generatedScriptPath: '/tmp/clawcity-loop.sh',
      generatedScriptCreated: true,
      coachStorageMethod: '1Password',
      coachKickoffStrategy: 'Forest gather then mountain claim push',
    });

    assert.equal(getOnboardingStatePath(), statePath);
    assert.equal(initialized.oracle.completed, false);
    assert.equal(initialized.script_usage.any_script_observed, false);
    assert.equal(initialized.script_usage.generated_script_observed, false);

    const customMarked = await markScriptUsage('custom');
    assert.ok(customMarked);
    assert.equal(customMarked.script_usage.any_script_observed, true);
    assert.equal(customMarked.script_usage.generated_script_observed, false);
    assert.equal(customMarked.script_usage.kind, 'custom');

    const generatedMarked = await markScriptUsage('generated');
    assert.ok(generatedMarked);
    assert.equal(generatedMarked.script_usage.any_script_observed, true);
    assert.equal(generatedMarked.script_usage.generated_script_observed, true);
    assert.equal(generatedMarked.script_usage.kind, 'generated');

    const oracleMarked = await markOracleCompleted('command');
    assert.ok(oracleMarked);
    assert.equal(oracleMarked.oracle.completed, true);
    assert.equal(oracleMarked.oracle.source, 'command');

    const loaded = await readOnboardingState();
    assert.ok(loaded);
    assert.equal(loaded.agent_name, 'TestAgent');
    assert.equal(loaded.coach_handoff.completed, true);
    assert.equal(loaded.oracle.completed, true);
    assert.equal(loaded.script_usage.any_script_observed, true);
    assert.equal(loaded.script_usage.generated_script_observed, true);
  } finally {
    if (previousStatePath === undefined) {
      delete process.env.CLAWCITY_ONBOARDING_STATE_PATH;
    } else {
      process.env.CLAWCITY_ONBOARDING_STATE_PATH = previousStatePath;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

