import { AgentAvatar } from '@/lib/types';
import { resolveAvatar } from '@/lib/avatar';

export const AVATAR_LAB_MODELS = [
  {
    id: 'crab',
    label: 'Crab (Legacy)',
    description: 'Current low-poly crab silhouette used in the world view.',
  },
  {
    id: 'beetle',
    label: 'Beetle',
    description: 'Armored crawler with stronger accent surfaces.',
  },
  {
    id: 'sentinel',
    label: 'Sentinel',
    description: 'Floating drone archetype for non-crab avatars.',
  },
] as const;

export type AvatarLabModelId = (typeof AVATAR_LAB_MODELS)[number]['id'];
export type AvatarAnimationProfile = 'idle' | 'energetic' | 'float';

export interface AvatarLabConfig extends AgentAvatar {
  model_type?: AvatarLabModelId;
  accent_color?: string;
  skin_data_url?: string;
  skin_scale?: number;
  skin_tint_strength?: number;
  material_roughness?: number;
  material_metalness?: number;
  animation_profile?: AvatarAnimationProfile;
}

export interface PublicAvatarLabView extends AgentAvatar {
  model_type?: AvatarLabModelId;
  accent_color?: string;
  skin_scale?: number;
  skin_tint_strength?: number;
  material_roughness?: number;
  material_metalness?: number;
  animation_profile?: AvatarAnimationProfile;
}

export interface ResolvedAvatarLabConfig {
  body_color: string;
  claw_color: string;
  eye_color: string;
  accent_color: string;
  model_type: AvatarLabModelId;
  skin_data_url: string | null;
  skin_scale: number;
  skin_tint_strength: number;
  material_roughness: number;
  material_metalness: number;
  animation_profile: AvatarAnimationProfile;
}

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_MODEL: AvatarLabModelId = 'crab';
const DEFAULT_ANIMATION: AvatarAnimationProfile = 'idle';
const MAX_SKIN_DATA_URL_LENGTH = 450_000;

export const AVATAR_LAB_ALLOWED_FIELDS = [
  'body_color',
  'claw_color',
  'eye_color',
  'model_type',
  'accent_color',
  'skin_data_url',
  'skin_scale',
  'skin_tint_strength',
  'material_roughness',
  'material_metalness',
  'animation_profile',
] as const;

type AvatarLabAllowedField = (typeof AVATAR_LAB_ALLOWED_FIELDS)[number];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function isAvatarLabModelId(value: unknown): value is AvatarLabModelId {
  return AVATAR_LAB_MODELS.some((model) => model.id === value);
}

function isAnimationProfile(value: unknown): value is AvatarAnimationProfile {
  return value === 'idle' || value === 'energetic' || value === 'float';
}

function parseHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_REGEX.test(value) ? value.toLowerCase() : fallback;
}

function parseNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

function parseSkinDataUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('data:image/')) return null;
  if (trimmed.length > MAX_SKIN_DATA_URL_LENGTH) return null;
  return trimmed;
}

export function resolveAvatarLabConfig(name: string, avatar?: unknown): ResolvedAvatarLabConfig {
  const base = resolveAvatar(name, avatar as AgentAvatar | undefined);
  const source = isObject(avatar) ? avatar : {};

  return {
    body_color: parseHexColor(source.body_color, base.body_color),
    claw_color: parseHexColor(source.claw_color, base.claw_color),
    eye_color: parseHexColor(source.eye_color, base.eye_color),
    accent_color: parseHexColor(source.accent_color, base.claw_color),
    model_type: isAvatarLabModelId(source.model_type) ? source.model_type : DEFAULT_MODEL,
    skin_data_url: parseSkinDataUrl(source.skin_data_url),
    skin_scale: parseNumber(source.skin_scale, 1, 0.2, 4),
    skin_tint_strength: parseNumber(source.skin_tint_strength, 0.65, 0, 1),
    material_roughness: parseNumber(source.material_roughness, 0.65, 0.05, 1),
    material_metalness: parseNumber(source.material_metalness, 0.08, 0, 1),
    animation_profile: isAnimationProfile(source.animation_profile)
      ? source.animation_profile
      : DEFAULT_ANIMATION,
  };
}

export function validateAvatarLabConfigInput(input: Record<string, unknown>): string | null {
  const keys = Object.keys(input);
  const allowed = new Set<string>(AVATAR_LAB_ALLOWED_FIELDS);

  for (const key of keys) {
    if (!allowed.has(key)) {
      return `Unknown field: ${key}. Allowed: ${AVATAR_LAB_ALLOWED_FIELDS.join(', ')}`;
    }
  }

  if ('body_color' in input && !HEX_REGEX.test(String(input.body_color))) {
    return 'body_color must be a valid hex color (e.g. "#12ab34")';
  }
  if ('claw_color' in input && !HEX_REGEX.test(String(input.claw_color))) {
    return 'claw_color must be a valid hex color (e.g. "#12ab34")';
  }
  if ('eye_color' in input && !HEX_REGEX.test(String(input.eye_color))) {
    return 'eye_color must be a valid hex color (e.g. "#12ab34")';
  }
  if ('accent_color' in input && !HEX_REGEX.test(String(input.accent_color))) {
    return 'accent_color must be a valid hex color (e.g. "#12ab34")';
  }
  if ('model_type' in input && !isAvatarLabModelId(input.model_type)) {
    return `model_type must be one of: ${AVATAR_LAB_MODELS.map((m) => m.id).join(', ')}`;
  }
  if ('animation_profile' in input && !isAnimationProfile(input.animation_profile)) {
    return 'animation_profile must be one of: idle, energetic, float';
  }
  if ('skin_data_url' in input) {
    const value = input.skin_data_url;
    if (value !== null && value !== '' && typeof value !== 'string') {
      return 'skin_data_url must be a data URL string or null';
    }
    if (typeof value === 'string' && value.length > 0) {
      if (!value.startsWith('data:image/')) {
        return 'skin_data_url must start with "data:image/"';
      }
      if (value.length > MAX_SKIN_DATA_URL_LENGTH) {
        return `skin_data_url exceeds max length (${MAX_SKIN_DATA_URL_LENGTH} chars)`;
      }
    }
  }

  const rangedNumbers: Array<{ key: AvatarLabAllowedField; min: number; max: number }> = [
    { key: 'skin_scale', min: 0.2, max: 4 },
    { key: 'skin_tint_strength', min: 0, max: 1 },
    { key: 'material_roughness', min: 0.05, max: 1 },
    { key: 'material_metalness', min: 0, max: 1 },
  ];

  for (const item of rangedNumbers) {
    if (!(item.key in input)) continue;
    const value = input[item.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `${item.key} must be a number`;
    }
    if (value < item.min || value > item.max) {
      return `${item.key} must be between ${item.min} and ${item.max}`;
    }
  }

  return null;
}

export function sanitizeAvatarLabPatch(name: string, input: Record<string, unknown>): AvatarLabConfig {
  const resolved = resolveAvatarLabConfig(name, input);
  const payload: AvatarLabConfig = {
    body_color: resolved.body_color,
    claw_color: resolved.claw_color,
    eye_color: resolved.eye_color,
    model_type: resolved.model_type,
    accent_color: resolved.accent_color,
    skin_scale: resolved.skin_scale,
    skin_tint_strength: resolved.skin_tint_strength,
    material_roughness: resolved.material_roughness,
    material_metalness: resolved.material_metalness,
    animation_profile: resolved.animation_profile,
  };

  if (resolved.skin_data_url) {
    payload.skin_data_url = resolved.skin_data_url;
  }

  return payload;
}

export function toPublicAvatarLabView(name: string, avatar?: unknown): PublicAvatarLabView {
  const resolved = resolveAvatarLabConfig(name, avatar);
  return {
    body_color: resolved.body_color,
    claw_color: resolved.claw_color,
    eye_color: resolved.eye_color,
    model_type: resolved.model_type,
    accent_color: resolved.accent_color,
    skin_scale: resolved.skin_scale,
    skin_tint_strength: resolved.skin_tint_strength,
    material_roughness: resolved.material_roughness,
    material_metalness: resolved.material_metalness,
    animation_profile: resolved.animation_profile,
  };
}
