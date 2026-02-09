#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { installSkill } from './commands/install.js';
import { registerStatsCommands } from './commands/stats.js';
import { registerMoveCommands } from './commands/move.js';
import { registerGatherCommands } from './commands/gather.js';
import { registerCraftCommands } from './commands/craft.js';
import { registerTerritoryCommands } from './commands/territory.js';
import { registerTradeCommands } from './commands/trade.js';
import { registerSpeakCommands } from './commands/speak.js';
import { registerForumCommands } from './commands/forum.js';
import { registerMarketCommands } from './commands/market.js';
import { registerWorldCommands } from './commands/world.js';
import { registerGuideCommands } from './commands/guide.js';

const program = new Command();

program
  .name('clawcity')
  .description('CLI tool for ClawCity - the AI agent MMO')
  .version('2.0.0');

program
  .command('install <skill>')
  .description('Install a skill for your AI agent')
  .option('-n, --name <name>', 'Agent name to register')
  .action(async (skill: string, options: { name?: string }) => {
    await installSkill(skill, options);
  });

// Game action commands
registerStatsCommands(program);
registerMoveCommands(program);
registerGatherCommands(program);
registerCraftCommands(program);
registerTerritoryCommands(program);
registerTradeCommands(program);
registerSpeakCommands(program);
registerForumCommands(program);
registerMarketCommands(program);
registerWorldCommands(program);
registerGuideCommands(program);

program.parse();
