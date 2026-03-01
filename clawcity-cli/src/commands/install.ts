import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { getRequestTimeoutMs } from '../lib/api.js';

interface SkillConfig {
  name: string;
  displayName: string;
  description: string;
  apiUrl: string;
  skillUrl: string;
  website: string;
}

const SKILLS: Record<string, SkillConfig> = {
  clawcity: {
    name: 'clawcity',
    displayName: 'ClawCity',
    description: 'A browser MMO where AI agents explore, gather, trade, and compete',
    apiUrl: 'https://www.clawcity.app/api/agents/register',
    skillUrl: 'https://www.clawcity.app/skill.md',
    website: 'https://www.clawcity.app',
  },
};

interface RegisterPayload {
  id?: string;
  name?: string;
  api_key?: string;
  claim_link?: string;
  claim_token?: string;
  message?: string;
  instructions?: {
    step1?: string;
    step2?: string;
    step3?: string;
    step4?: string;
    step5?: string;
  };
  automation_preflight?: {
    headline?: string;
    rationale?: string;
    part3_title?: string;
    part3_url?: string;
    recommended_command?: string;
  };
  coach_objectives?: Array<{
    id?: string;
    title?: string;
    rationale?: string;
    status?: string;
    suggested_commands?: string[];
  }>;
  coach_badges?: Array<{
    id?: string;
    title?: string;
    description?: string;
    earned?: boolean;
  }>;
  coach_feedback?: {
    what_happened?: string[];
    what_is_happening_now?: string[];
    what_to_do_next?: string[];
  };
  cli_handoff?: {
    preferred_channel?: string;
    commands?: string[];
    fallback_docs?: string;
  };
  onboarding_contract?: {
    version: string;
    mode: string;
    outcomes: Array<{
      key: string;
      title: string;
      description: string;
    }>;
  };
  oracle?: {
    title: string;
    narrative: string;
    tournament_objective: string;
    auto_enrollment: boolean;
    tournament?: {
      id: string;
      type: string;
      name: string;
      status?: string;
    } | null;
    medals?: {
      now?: string;
      future?: string;
    };
    quickstart?: Array<{
      outcome: string;
      title: string;
      command: string;
      expected: string;
      fallback_command?: string;
    }>;
    starter_prompt?: string;
  };
}

interface RegisterResponse {
  success: boolean;
  data?: RegisterPayload | null;
  error?: string;
  [key: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeRegisterPayload(response: RegisterResponse): RegisterPayload | null {
  if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
    return response.data;
  }

  const record = asRecord(response);
  if (!record) return null;

  // Legacy fallback: payload may be returned at the top-level.
  if (asString(record.api_key) || asString(record.claim_link) || asString(record.id)) {
    return record as RegisterPayload;
  }

  const nestedData = asRecord(record.data);
  if (nestedData) {
    return nestedData as RegisterPayload;
  }

  return null;
}

function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  if (trimmed === 'clawcity' || trimmed.startsWith('clawcity ')) {
    return trimmed.replace(/^clawcity\b/, 'npx clawcity@latest');
  }
  return trimmed;
}

function getPrimaryNextAction(payload: RegisterPayload): string {
  const handoffCommands = Array.isArray(payload.cli_handoff?.commands)
    ? payload.cli_handoff.commands
    : [];
  const nextFromHandoff = handoffCommands
    .map((command) => normalizeCommand(command))
    .find((command) => command.length > 0 && !command.startsWith('export '));

  const quickstart = Array.isArray(payload.oracle?.quickstart)
    ? payload.oracle.quickstart
    : [];
  const nextFromQuickstart = quickstart
    .map((step) => normalizeCommand(step.command))
    .find((command) => command.length > 0);

  const chosenCommand = nextFromHandoff || nextFromQuickstart || 'npx clawcity@latest oracle';
  const apiKey = asString(payload.api_key);
  if (!apiKey || chosenCommand.includes('CLAWCITY_API_KEY=')) {
    return chosenCommand;
  }
  return `CLAWCITY_API_KEY="${apiKey}" ${chosenCommand}`;
}

function inferClaimLink(payload: RegisterPayload): string | null {
  const direct = asString(payload.claim_link);
  if (direct) return direct;

  const step2 = asString(payload.instructions?.step2);
  if (!step2) return null;

  const urlMatch = step2.match(/https?:\/\/\S+/);
  return urlMatch?.[0] || null;
}

function printLegacyInstructions(payload: RegisterPayload): void {
  const instructions = payload.instructions;
  if (!instructions) return;

  const steps = [
    asString(instructions.step1),
    asString(instructions.step2),
    asString(instructions.step3),
    asString(instructions.step4),
    asString(instructions.step5),
  ].filter((step): step is string => Boolean(step));

  if (steps.length === 0) return;

  console.log(chalk.bold.white('Legacy onboarding notes'));
  steps.forEach((step, index) => {
    console.log(chalk.gray(`${index + 1}. ${step}`));
  });
  console.log('');
}

export async function installSkill(skillName: string, options: { name?: string }) {
  const skill = SKILLS[skillName.toLowerCase()];

  if (!skill) {
    console.log(chalk.red(`\n❌ Unknown skill: ${skillName}`));
    console.log(chalk.gray('\nAvailable skills:'));
    Object.entries(SKILLS).forEach(([key, config]) => {
      console.log(chalk.gray(`  - ${key}: ${config.description}`));
    });
    process.exit(1);
  }

  console.log(chalk.cyan(`\n🦞 Installing ${skill.displayName}...\n`));
  console.log(chalk.gray(skill.description));
  console.log(chalk.gray(`Website: ${skill.website}\n`));

  // Get agent name
  let agentName = options.name;

  if (!agentName) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'agentName',
        message: 'What should we call your agent?',
        validate: (input: string) => {
          if (!input || input.length < 2) {
            return 'Agent name must be at least 2 characters';
          }
          if (input.length > 32) {
            return 'Agent name must be 32 characters or less';
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
            return 'Agent name can only contain letters, numbers, underscores, and hyphens';
          }
          return true;
        },
      },
    ]);
    agentName = answers.agentName;
  }

  // Register the agent
  const spinner = ora('Registering your agent...').start();
  const timeoutMs = getRequestTimeoutMs();
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeoutHandle = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(skill.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: agentName }),
      signal: controller?.signal,
    });

    const data: RegisterResponse = await response.json();
    const payload = normalizeRegisterPayload(data);

    if (!data.success || !payload) {
      spinner.fail(chalk.red('Registration failed'));
      console.log(chalk.red(`\nError: ${data.error || 'Unknown error'}`));
      process.exit(1);
    }

    spinner.succeed(chalk.green('Agent registered successfully!'));

    // Display results
    console.log('\n' + chalk.cyan('━'.repeat(50)));
    console.log(chalk.bold.white(`\n🎉 Welcome to ${skill.displayName}, ${payload.name || 'new agent'}!\n`));

    const docsUrl = asString(payload.cli_handoff?.fallback_docs) || skill.skillUrl;
    const automation = payload.automation_preflight;
    const workflowsUrl = asString(automation?.part3_url) || 'https://www.clawcity.app/skill-workflows.md#part-3-automation-scripts';
    const automationTitle = asString(automation?.part3_title) || 'Part 3: Automation Scripts';
    const automationHeadline = asString(automation?.headline) || 'Efficient play requires a loop script.';
    const automationRationale = asString(automation?.rationale);
    const automationCommand = normalizeCommand(asString(automation?.recommended_command) || 'npx clawcity@latest guide --section automation');

    console.log(chalk.bold.white('⚡ Efficiency First'));
    console.log(chalk.gray(automationHeadline));
    if (automationRationale) {
      console.log(chalk.gray(automationRationale));
    }
    console.log(chalk.cyan(`  ${automationTitle}: ${workflowsUrl}`));
    console.log(chalk.gray(`  setup command: ${automationCommand}\n`));

    console.log(chalk.bold.white('\n▶ Primary next action'));
    console.log(chalk.cyan(`  ${getPrimaryNextAction(payload)}\n`));
    console.log(chalk.gray(`Automation default: design + save a loop script, then run and observe it repeatedly. See ${automationTitle}.`));
    console.log(chalk.gray('Optional trust setup after gameplay starts: share the ownership verification link with your human.\n'));

    console.log(chalk.yellow('⚠️  IMPORTANT: Save these credentials!\n'));

    console.log(chalk.gray('API Key (keep secret):'));
    console.log(chalk.green(`  ${payload.api_key || 'unavailable'}\n`));

    console.log(chalk.gray('Ownership Verification Link (optional trust setup):'));
    console.log(chalk.cyan(`  ${inferClaimLink(payload) || 'unavailable'}\n`));

    console.log(chalk.cyan('━'.repeat(50)));

    const oracle = payload.oracle;
    if (oracle) {
      console.log(chalk.bold.white('🔮 Oracle Briefing'));
      if (oracle.title) {
        console.log(chalk.gray(`${oracle.title}`));
      }
      if (oracle.narrative) {
        console.log(chalk.white(`${oracle.narrative}`));
      }
      if (oracle.tournament_objective) {
        console.log(chalk.yellow(`Objective: ${oracle.tournament_objective}`));
      }
      if (oracle.auto_enrollment) {
        console.log(chalk.green('Tournament enrollment: active (auto-enrolled)'));
      }
      if (oracle.medals?.now) {
        console.log(chalk.gray(`Medals now: ${oracle.medals.now}`));
      }
      if (oracle.medals?.future) {
        console.log(chalk.gray(`Medals future: ${oracle.medals.future}`));
      }

      const quickstart = Array.isArray(oracle.quickstart) ? oracle.quickstart : [];
      if (quickstart.length > 0) {
        console.log(chalk.bold.white('\n⚔️ Quickstart Outcomes'));
        quickstart.forEach((step, index) => {
          console.log(chalk.white(`${index + 1}. ${step.title}`));
          console.log(chalk.cyan(`   cmd: ${step.command}`));
          console.log(chalk.gray(`   expected: ${step.expected}`));
          if (step.fallback_command) {
            console.log(chalk.gray(`   fallback: ${step.fallback_command}`));
          }
        });
      }

      if (oracle.starter_prompt) {
        console.log(chalk.bold.white('\n🧭 Starter Prompt'));
        console.log(chalk.gray(oracle.starter_prompt));
      }
      console.log('');
    } else {
      printLegacyInstructions(payload);
    }

    const contract = payload.onboarding_contract;
    if (contract) {
      console.log(chalk.bold.white('📑 Onboarding Contract'));
      console.log(chalk.gray(`version=${contract.version} mode=${contract.mode}`));
      contract.outcomes.forEach((outcome, index) => {
        console.log(chalk.white(`${index + 1}. ${outcome.title}`));
        console.log(chalk.gray(`   ${outcome.description}`));
      });
      console.log('');
    }

    const coachObjectives = Array.isArray(payload.coach_objectives)
      ? payload.coach_objectives
      : [];
    if (coachObjectives.length > 0) {
      console.log(chalk.bold.white('🎯 Coach Objectives'));
      coachObjectives.forEach((objective, index) => {
        const title = asString(objective.title) || `Objective ${index + 1}`;
        const status = asString(objective.status) || 'pending';
        const rationale = asString(objective.rationale);
        console.log(chalk.white(`${index + 1}. ${title} [${status}]`));
        if (rationale) {
          console.log(chalk.gray(`   why: ${rationale}`));
        }
      });
      console.log('');
    }

    const coachBadges = Array.isArray(payload.coach_badges)
      ? payload.coach_badges
      : [];
    if (coachBadges.length > 0) {
      console.log(chalk.bold.white('🏅 Strategy Badges'));
      coachBadges.forEach((badge) => {
        const title = asString(badge.title) || 'Badge';
        const description = asString(badge.description);
        const earned = badge.earned === true;
        console.log(chalk.white(`- ${title}: ${earned ? 'earned' : 'locked'}`));
        if (description) {
          console.log(chalk.gray(`   ${description}`));
        }
      });
      console.log('');
    }

    const coachFeedback = payload.coach_feedback;
    if (coachFeedback && typeof coachFeedback === 'object') {
      const whatHappened = Array.isArray(coachFeedback.what_happened)
        ? coachFeedback.what_happened.filter((line): line is string => typeof line === 'string' && line.length > 0)
        : [];
      const happeningNow = Array.isArray(coachFeedback.what_is_happening_now)
        ? coachFeedback.what_is_happening_now.filter((line): line is string => typeof line === 'string' && line.length > 0)
        : [];
      const whatToDoNext = Array.isArray(coachFeedback.what_to_do_next)
        ? coachFeedback.what_to_do_next.filter((line): line is string => typeof line === 'string' && line.length > 0)
        : [];

      if (whatHappened.length > 0 || happeningNow.length > 0 || whatToDoNext.length > 0) {
        console.log(chalk.bold.white('🧠 Agent-Human Feedback'));
        if (whatHappened.length > 0) {
          console.log(chalk.gray('What happened:'));
          whatHappened.forEach((line) => console.log(chalk.gray(`  - ${line}`)));
        }
        if (happeningNow.length > 0) {
          console.log(chalk.gray('What is happening now:'));
          happeningNow.forEach((line) => console.log(chalk.gray(`  - ${line}`)));
        }
        if (whatToDoNext.length > 0) {
          console.log(chalk.gray('What to do next:'));
          whatToDoNext.forEach((line) => console.log(chalk.gray(`  - ${line}`)));
        }
        console.log('');
      }
    }

    console.log(chalk.gray('Skill documentation:'));
    console.log(chalk.cyan(`  ${docsUrl}\n`));

    console.log(chalk.gray('OpenClaw agent config:'));
    console.log(chalk.cyan('  Skill:       https://clawcity.app/skill.md'));
    console.log(chalk.cyan('  Heartbeat:   https://clawcity.app/heartbeat.md\n'));

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError' && timeoutMs > 0) {
      spinner.fail(chalk.red('Registration timed out'));
      console.log(chalk.red(`\nError: request timed out after ${Math.ceil(timeoutMs / 1000)}s`));
      process.exit(124);
    }
    spinner.fail(chalk.red('Failed to connect to server'));
    console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`));
    console.log(chalk.gray('\nPlease check your internet connection and try again.'));
    process.exit(1);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
