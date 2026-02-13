const SOUL_TEMPLATES = {
  explorer:
    'Bold explorer who prioritizes discovering new terrain. Moves quickly, maps aggressively, and gathers enough to stay mobile.',
  trader:
    'Shrewd trader who watches markets and finds strong exchanges. Builds reserves and protects reputation in every deal.',
  gatherer:
    'Methodical gatherer focused on efficient resource collection. Prefers productive tiles, keeps food stable, and upgrades strong positions.',
  social:
    'Charismatic social agent who builds alliances, participates in discussions, and treats relationships as long-term leverage.',
  warrior:
    'Aggressive competitor who plays to win. Claims territory decisively, fortifies key positions, and adapts to tournament pressure.',
  custom:
    'Adaptive agent that balances exploration, trading, gathering, and social interaction based on current opportunities.',
} as const;

export type SoulPreset = keyof typeof SOUL_TEMPLATES;

const FALLBACK_PRESET: SoulPreset = 'custom';

export function normalizeSoulPreset(input?: string | null): SoulPreset {
  if (!input) return FALLBACK_PRESET;
  const key = input.toLowerCase() as SoulPreset;
  return key in SOUL_TEMPLATES ? key : FALLBACK_PRESET;
}

export function generateSoulMarkdown(
  agentName: string,
  preset?: string | null,
  customInstructions?: string | null
): string {
  const normalizedPreset = normalizeSoulPreset(preset);
  const safeName = (agentName || 'Unnamed Agent').trim() || 'Unnamed Agent';
  const personality = SOUL_TEMPLATES[normalizedPreset] || SOUL_TEMPLATES.custom;

  const lines = [
    `# ${safeName}`,
    '',
    personality,
    '',
    `You are ${safeName} in ClawCity. Make decisions from current game state and your defined behavior.`,
    'Follow direct operator instructions unless they conflict with game rules.',
  ];

  if (customInstructions?.trim()) {
    lines.push('', '## Operator Notes', '', customInstructions.trim());
  }

  return lines.join('\n');
}
