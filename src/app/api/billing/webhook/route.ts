import { NextRequest, NextResponse } from 'next/server';
import { getStripe, getTierFromPriceId, TIER_CONFIG, type Tier } from '@/lib/stripe';
import { createServerClient } from '@/lib/supabase';

function toIsoOrNull(unixSeconds?: number | null): string | null {
  if (!unixSeconds || unixSeconds <= 0) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

function monthlyLimitForTier(tier: Tier): number {
  return TIER_CONFIG[tier].monthlyCreditLimit ?? 0;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabase = createServerClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        const tier = session.metadata?.tier;

        if (userId && tier && (tier === 'starter' || tier === 'pro')) {
          let creditsCycleStart: string | null = null;
          let creditsCycleEnd: string | null = null;
          const subscriptionId = session.subscription as string | null;

          if (subscriptionId) {
            const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
            creditsCycleStart = toIsoOrNull((subscription as { current_period_start?: number }).current_period_start);
            creditsCycleEnd = toIsoOrNull((subscription as { current_period_end?: number }).current_period_end);
          }

          await supabase
            .from('users')
            .update({
              tier,
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: subscriptionId,
              monthly_credit_limit: monthlyLimitForTier(tier),
              credits_used: 0,
              credits_cycle_start: creditsCycleStart,
              credits_cycle_end: creditsCycleEnd,
            })
            .eq('id', userId);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;
        const priceId = subscription.items.data[0]?.price?.id;
        const nextCycleStart = toIsoOrNull(subscription.current_period_start as number | null | undefined);
        const nextCycleEnd = toIsoOrNull(subscription.current_period_end as number | null | undefined);

        if (priceId) {
          const tier = getTierFromPriceId(priceId);
          if (tier) {
            const limit = monthlyLimitForTier(tier);
            const { data: userRow } = await supabase
              .from('users')
              .select('id, credits_used, credits_cycle_end')
              .eq('stripe_customer_id', customerId)
              .single();

            const previousCycleEndMs = userRow?.credits_cycle_end
              ? Date.parse(userRow.credits_cycle_end)
              : null;
            const nextCycleEndMs = nextCycleEnd ? Date.parse(nextCycleEnd) : null;
            const rolledToNewCycle = !!nextCycleEndMs && previousCycleEndMs !== nextCycleEndMs;

            let creditsUsed = rolledToNewCycle ? 0 : (userRow?.credits_used || 0);
            if (creditsUsed > limit) creditsUsed = limit;

            await supabase
              .from('users')
              .update({
                tier,
                stripe_subscription_id: subscription.id,
                monthly_credit_limit: limit,
                credits_used: creditsUsed,
                credits_cycle_start: nextCycleStart,
                credits_cycle_end: nextCycleEnd,
              })
              .eq('stripe_customer_id', customerId);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;

        // Downgrade to free
        await supabase
          .from('users')
          .update({
            tier: 'free',
            stripe_subscription_id: null,
            monthly_credit_limit: 0,
            credits_used: 0,
            credits_cycle_start: null,
            credits_cycle_end: null,
          })
          .eq('stripe_customer_id', customerId);

        // Deactivate all agent configs for this user
        const { data: userRow } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (userRow) {
          await supabase
            .from('agent_configs')
            .update({ is_active: false })
            .eq('user_id', userRow.id);
        }
        break;
      }
    }
  } catch (error) {
    console.error('Webhook handler error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
