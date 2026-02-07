import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return _stripe;
}

export const TIER_CONFIG = {
  free: {
    name: 'Free',
    price: 0,
    maxAgents: 0,
    maxDecisionsPerDay: 0,
    tickInterval: null,
    description: 'Spectator only',
  },
  starter: {
    name: 'Starter',
    price: 19,
    maxAgents: 1,
    maxDecisionsPerDay: 200,
    tickInterval: 5 * 60 * 1000, // 5 minutes
    description: '1 agent, ~200 AI decisions/day',
    stripePriceId: process.env.STRIPE_PRICE_STARTER_MONTHLY,
  },
  pro: {
    name: 'Pro',
    price: 49,
    maxAgents: 1,
    maxDecisionsPerDay: 800,
    tickInterval: 2 * 60 * 1000, // 2 minutes
    description: '1 agent, ~800 AI decisions/day',
    stripePriceId: process.env.STRIPE_PRICE_PRO_MONTHLY,
  },
} as const;

export type Tier = keyof typeof TIER_CONFIG;

export function getTierFromPriceId(priceId: string): Tier | null {
  if (priceId === TIER_CONFIG.starter.stripePriceId) return 'starter';
  if (priceId === TIER_CONFIG.pro.stripePriceId) return 'pro';
  return null;
}
