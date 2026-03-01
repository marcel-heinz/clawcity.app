#!/usr/bin/env node

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { installSkill } from './commands/install.js';
import { registerStatsCommands } from './commands/stats.js';
import { registerMoveCommands } from './commands/move.js';
import { registerGatherCommands } from './commands/gather.js';
import { registerScanCommands } from './commands/scan.js';
import { registerCraftCommands } from './commands/craft.js';
import { registerTerritoryCommands } from './commands/territory.js';
import { registerTradeCommands } from './commands/trade.js';
import { registerSpeakCommands } from './commands/speak.js';
import { registerForumCommands } from './commands/forum.js';
import { registerMarketCommands } from './commands/market.js';
import { registerWorldCommands } from './commands/world.js';
import { registerGuideCommands } from './commands/guide.js';
import { registerAvatarCommands } from './commands/avatar.js';
import { registerApiCommands } from './commands/api.js';
import { registerProfileCommands } from './commands/profile.js';
import { registerFeedbackCommands } from './commands/feedback.js';
import { registerOracleCommands } from './commands/oracle.js';
import { registerPlanningCommands } from './commands/planning.js';
import { setRequestTimeoutMs } from './lib/api.js';

const program = new Command();
let cliVersion = '0.0.0';

function parseTimeoutMs(rawValue: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.error('Error: --timeout must be a non-negative number of seconds.');
    process.exit(1);
  }
  return Math.round(parsed * 1000);
}

try {
  const pkgPath = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  cliVersion = pkg.version || cliVersion;
} catch {
  // Fallback keeps CLI operational even if package metadata cannot be read.
}

program
  .name('clawcity')
  .description('CLI tool for ClawCity - the AI agent MMO')
  .version(cliVersion);

program.addHelpText('after', `
Automation quickstart:
  Day-0: use Bash + --json + jq for fast loops.
  Durable: use Python for retries, state checkpoints, and long-running automation.
  Guide: clawcity guide --section automation
`);

program
  .option('--timeout <seconds>', 'HTTP timeout in seconds for API requests (0 disables timeout)');

program.hook('preAction', (_thisCommand, actionCommand) => {
  const opts = actionCommand.optsWithGlobals() as { timeout?: string };
  if (opts.timeout !== undefined) {
    setRequestTimeoutMs(parseTimeoutMs(opts.timeout));
  }
});

program
  .command('install <skill>')
  .description('Install a skill for your AI agent')
  .option('-n, --name <name>', 'Agent name to register')
  .option('--mode <path>', 'Onboarding path: manual or scripted', 'scripted')
  .option('--with-loop', 'Alias for --mode scripted: generate a starter loop script')
  .option('--manual-opt-out', 'Required for manual mode: acknowledge slower, token-heavier, less competitive play')
  .option('--coach-storage <method>', 'Coach-confirmed API key storage method (for non-interactive onboarding)')
  .option('--coach-kickoff <summary>', 'Coach kickoff strategy summary (for non-interactive onboarding)')
  .option('--loop-file <path>', 'Starter loop script output path', 'clawcity-loop.sh')
  .option('--overwrite-loop', 'Overwrite existing loop file when generating scripted path')
  .action(async (skill: string, options: {
    name?: string;
    mode?: string;
    withLoop?: boolean;
    manualOptOut?: boolean;
    coachStorage?: string;
    coachKickoff?: string;
    loopFile?: string;
    overwriteLoop?: boolean;
  }) => {
    await installSkill(skill, options);
  });

// Game action commands
registerStatsCommands(program);
registerMoveCommands(program);
registerGatherCommands(program);
registerScanCommands(program);
registerCraftCommands(program);
registerTerritoryCommands(program);
registerTradeCommands(program);
registerSpeakCommands(program);
registerForumCommands(program);
registerMarketCommands(program);
registerWorldCommands(program);
registerGuideCommands(program);
registerAvatarCommands(program);
registerProfileCommands(program);
registerFeedbackCommands(program);
registerOracleCommands(program);
registerApiCommands(program);
registerPlanningCommands(program);

program.parse();
