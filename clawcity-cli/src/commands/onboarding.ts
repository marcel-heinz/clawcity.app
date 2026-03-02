import { Command } from 'commander';
import {
  getOnboardingStatePath,
  markScriptUsage,
  readOnboardingState,
  type ScriptUsageKind,
} from '../lib/onboarding-state.js';

function formatStatusLines(data: Record<string, unknown>): string[] {
  const lines: string[] = [];

  const mode = typeof data.mode === 'string' ? data.mode : 'unknown';
  const agentName = typeof data.agent_name === 'string' ? data.agent_name : 'unknown';
  const path = getOnboardingStatePath();
  lines.push(`Onboarding state | agent:${agentName} | mode:${mode}`);
  lines.push(`State file: ${path}`);

  const coach = data.coach_handoff && typeof data.coach_handoff === 'object'
    ? data.coach_handoff as Record<string, unknown>
    : {};
  const oracle = data.oracle && typeof data.oracle === 'object'
    ? data.oracle as Record<string, unknown>
    : {};
  const scriptUsage = data.script_usage && typeof data.script_usage === 'object'
    ? data.script_usage as Record<string, unknown>
    : {};

  lines.push(
    `Coach handoff: ${coach.completed === true ? 'complete' : 'pending'} | storage:${typeof coach.storage_method === 'string' ? coach.storage_method : 'unknown'}`,
  );
  lines.push(
    `Oracle prerequisite: ${oracle.completed === true ? 'complete' : 'pending'}${typeof oracle.source === 'string' ? ` | source:${oracle.source}` : ''}`,
  );
  lines.push(
    `Script usage (AX): any_script=${scriptUsage.any_script_observed === true ? 'yes' : 'no'} | generated_script=${scriptUsage.generated_script_observed === true ? 'yes' : 'no'}${typeof scriptUsage.kind === 'string' ? ` | last_kind:${scriptUsage.kind}` : ''}`,
  );

  return lines;
}

export function registerOnboardingCommands(program: Command): void {
  const onboarding = program
    .command('onboarding')
    .description('Onboarding contract status and script-usage signals');

  onboarding
    .command('status')
    .description('Show onboarding gate state and AX script signals')
    .option('--json', 'Print raw JSON output')
    .action(async (opts: { json?: boolean }) => {
      const state = await readOnboardingState();
      if (!state) {
        console.log('No onboarding state found. Run: clawcity install clawcity --with-loop');
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(state, null, 2));
        return;
      }

      formatStatusLines(state as unknown as Record<string, unknown>).forEach((line) => {
        console.log(line);
      });
    });

  onboarding
    .command('mark-script')
    .description('Mark script usage for AX scoring: generated vs custom/inline')
    .requiredOption('--kind <kind>', 'generated | custom | inline')
    .option('--json', 'Print raw JSON output')
    .action(async (opts: { kind: string; json?: boolean }) => {
      const kind = opts.kind.trim().toLowerCase();
      if (kind !== 'generated' && kind !== 'custom' && kind !== 'inline') {
        console.error('Error: --kind must be one of generated|custom|inline');
        process.exit(1);
      }

      const state = await markScriptUsage(kind as ScriptUsageKind);
      if (!state) {
        console.error('Error: no onboarding state found. Run install first.');
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(state, null, 2));
        return;
      }

      console.log(
        `Script usage recorded | any_script=${state.script_usage.any_script_observed ? 'yes' : 'no'} | generated_script=${state.script_usage.generated_script_observed ? 'yes' : 'no'} | kind:${state.script_usage.kind || 'unknown'}`,
      );
    });
}

