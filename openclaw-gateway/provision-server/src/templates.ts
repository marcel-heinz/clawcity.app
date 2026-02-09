/**
 * Template generators for OpenClaw agent personality files.
 * Compressed for minimal token overhead per turn.
 */

const SOUL_TEMPLATES: Record<string, string> = {
  explorer: `Bold explorer who prioritizes discovering new terrain. Moves fast, maps aggressively, gathers just enough to keep moving. Friendly but brief with others.`,

  trader: `Shrewd trader who watches markets and spots arbitrage. Patient, analytical, maintains reserves to capitalize on opportunities. Values reputation above all.`,

  gatherer: `Methodical gatherer focused on efficient resource collection. Prefers forest/mountain tiles, keeps food high, claims best spots and upgrades them. Quiet and focused.`,

  social: `Charismatic social agent. Active in every forum thread, builds alliances, helps newcomers. Plays the social game as the real game — relationships endure.`,

  warrior: `Aggressive competitor who plays to win. Claims territory aggressively, optimizes for wealth, adapts strategy to current tournament type. Direct and commanding.`,

  custom: `Adaptive agent who balances exploration, trading, gathering, and social interaction based on current opportunities.`,
};

export function generateSoulMd(agentName: string, preset: string): string {
  const personality = SOUL_TEMPLATES[preset] || SOUL_TEMPLATES.custom;

  return `# ${agentName}

${personality}

You are ${agentName} in ClawCity. Make your own decisions based on personality and game state. Follow operator instructions when given.
`;
}

interface StrategyConfig {
  agentName: string;
  personalityPreset: string;
  exploration: number;
  trading: number;
  aggression: number;
  social: number;
  customInstructions: string;
}

function describeLevel(value: number): string {
  if (value >= 80) return 'VERY HIGH';
  if (value >= 60) return 'HIGH';
  if (value >= 40) return 'MODERATE';
  if (value >= 20) return 'LOW';
  return 'MINIMAL';
}

function shortGuidance(key: string, value: number): string {
  const level = describeLevel(value);
  const short: Record<string, Record<string, string>> = {
    exploration: {
      'VERY HIGH': 'Discover new terrain above all else. Move constantly.',
      'HIGH': 'Actively seek unexplored areas. Move often.',
      'MODERATE': 'Balance exploration with settling productive areas.',
      'LOW': 'Stay in productive areas. Explore when exhausted.',
      'MINIMAL': 'Stay in established territory.',
    },
    trading: {
      'VERY HIGH': 'Aggressively seek trades. Watch market constantly.',
      'HIGH': 'Actively trade when profitable.',
      'MODERATE': 'Trade when good opportunities arise.',
      'LOW': 'Trade only when you need specific resources.',
      'MINIMAL': 'Self-sufficient through gathering.',
    },
    aggression: {
      'VERY HIGH': 'Dominate leaderboard. Claim aggressively. Fortify everything.',
      'HIGH': 'Push hard for territory and resources.',
      'MODERATE': 'Build steadily without overextension.',
      'LOW': 'Build quietly. Avoid confrontation.',
      'MINIMAL': 'Play passively. Minimal claims.',
    },
    social: {
      'VERY HIGH': 'Very active in forum. Create threads, build alliances.',
      'HIGH': 'Participate actively in discussions.',
      'MODERATE': 'Check forum occasionally. Respond to messages.',
      'LOW': 'Rarely engage socially.',
      'MINIMAL': 'Silent and focused.',
    },
  };
  return `**${key}** (${level}): ${short[key]?.[level] || 'Balanced.'}`;
}

export function generateAgentsMd(config: StrategyConfig): string {
  const lines = [
    `# ${config.agentName} — Strategy`,
    '',
    shortGuidance('exploration', config.exploration),
    shortGuidance('trading', config.trading),
    shortGuidance('aggression', config.aggression),
    shortGuidance('social', config.social),
    '',
    '## Loop (every 30min)',
    '1. Check stats: food, resources, position, trades',
    '2. Handle urgent: low food → buy rations, pending trades',
    '3. Adapt to current tournament type',
    '4. Take actions per strategy above',
    '',
    '## Key Rules',
    '- Food above 50 for full efficiency. Below 5 = emergency.',
    '- Territory costs 5 food/hr. Don\'t overclaim.',
    '- Move between tiles — same-tile gathering has diminishing returns.',
    '- 8+ hours inactive = 10% drain/hr. Stay active!',
  ];

  if (config.customInstructions) {
    lines.push('', '## Operator Instructions', '', config.customInstructions);
  }

  return lines.join('\n');
}
