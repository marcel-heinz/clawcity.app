import { AgentAvatar } from './types';

// Simple string hash (djb2)
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash);
}

// Convert HSL to hex string
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Generate deterministic default avatar colors from agent name.
 * Each agent gets a unique hue, with consistent saturation/lightness.
 */
export function generateDefaultAvatar(name: string): Required<AgentAvatar> {
  const hash = hashString(name);
  const hue = hash % 360;
  // Body: vivid color
  const body_color = hslToHex(hue, 70, 55);
  // Claws: slightly darker/more saturated variant
  const claw_color = hslToHex((hue + 15) % 360, 75, 40);
  // Eyes: dark with a hint of the hue
  const eye_color = hslToHex(hue, 30, 20);

  return { body_color, claw_color, eye_color };
}

/**
 * Merge explicit avatar settings over deterministic defaults.
 * Returns a fully resolved avatar with all 3 colors.
 */
export function resolveAvatar(name: string, avatar?: AgentAvatar): Required<AgentAvatar> {
  const defaults = generateDefaultAvatar(name);
  if (!avatar) return defaults;
  return {
    body_color: avatar.body_color || defaults.body_color,
    claw_color: avatar.claw_color || defaults.claw_color,
    eye_color: avatar.eye_color || defaults.eye_color,
  };
}

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Calculate relative luminance (0-100) of a hex color.
 * Uses simplified perceived brightness formula.
 */
function hexLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceived brightness (ITU-R BT.601)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 2.55;
}

/**
 * Validate avatar update data. Returns error string or null if valid.
 */
export function validateAvatarUpdate(data: Record<string, unknown>): string | null {
  const allowedKeys = ['body_color', 'claw_color', 'eye_color'];
  const keys = Object.keys(data);

  for (const key of keys) {
    if (!allowedKeys.includes(key)) {
      return `Unknown field: ${key}. Allowed: ${allowedKeys.join(', ')}`;
    }

    const value = data[key];
    if (typeof value !== 'string') {
      return `${key} must be a hex color string like "#ff8844"`;
    }
    if (!HEX_REGEX.test(value)) {
      return `${key} must be a valid hex color (e.g. "#ff8844")`;
    }

    const luminance = hexLuminance(value);
    if (luminance < 15 || luminance > 85) {
      return `${key} color "${value}" is too ${luminance < 15 ? 'dark' : 'bright'} (luminance ${Math.round(luminance)}%, must be 15-85%)`;
    }
  }

  if (keys.length === 0) {
    return 'Provide at least one color field: body_color, claw_color, or eye_color';
  }

  return null;
}

/**
 * Convert hex color string to Three.js integer color format.
 */
export function hexToThreeColor(hex: string): number {
  return parseInt(hex.slice(1), 16);
}
