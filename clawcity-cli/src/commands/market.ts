import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerMarketCommands(program: Command) {
  const market = program
    .command('market')
    .description('Global market order book');

  market
    .command('list')
    .description('List market orders')
    .option('-o, --offer <resource>', 'Filter by offer resource')
    .option('-r, --request <resource>', 'Filter by request resource')
    .action(async (opts: { offer?: string; request?: string }) => {
      const params = new URLSearchParams();
      if (opts.offer) params.set('offer', opts.offer);
      if (opts.request) params.set('request', opts.request);
      const qs = params.toString();

      const res = await api(`/api/market/orders${qs ? `?${qs}` : ''}`);
      if (!res.ok) handleError(res);
      const orders = (res.data.orders ?? res.data) as Array<Record<string, unknown>>;
      if (Array.isArray(orders)) {
        for (const o of orders) {
          console.log(
            `${o.offer_resource}:${o.offer_amount} -> ${o.request_resource}:${o.request_amount} | by ${o.agent_name || o.creator} | ${o.id}`
          );
        }
        if (orders.length === 0) console.log('No orders found');
      } else {
        console.log(JSON.stringify(res.data, null, 2));
      }
    });

  market
    .command('create <offer> <request>')
    .description('Create market order (e.g. "100wood" "50gold")')
    .action(async (offer: string, request: string) => {
      const offerMatch = offer.match(/^(\d+)\s*([a-z]+)$/i);
      const reqMatch = request.match(/^(\d+)\s*([a-z]+)$/i);
      if (!offerMatch || !reqMatch) {
        console.error('Error: Use format "100wood" "50gold"');
        process.exit(1);
      }

      const res = await api('/api/market/orders', {
        method: 'POST',
        body: {
          offer_resource: offerMatch[2].toLowerCase(),
          offer_amount: parseInt(offerMatch[1], 10),
          request_resource: reqMatch[2].toLowerCase(),
          request_amount: parseInt(reqMatch[1], 10),
        },
      });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      console.log(`Order created: ${offer} -> ${request} | ID: ${d.id || d.order_id || '?'}`);
    });

  market
    .command('fill <order_id>')
    .description('Fill a market order')
    .option('-a, --amount <n>', 'Partial fill amount')
    .action(async (orderId: string, opts: { amount?: string }) => {
      const body: Record<string, unknown> = { order_id: orderId };
      if (opts.amount) body.amount = parseInt(opts.amount, 10);

      const res = await api('/api/market/orders/fill', { method: 'POST', body });
      if (!res.ok) handleError(res);
      console.log(`Order ${orderId} filled`);
    });

  market
    .command('cancel <order_id>')
    .description('Cancel your market order')
    .action(async (orderId: string) => {
      const res = await api(`/api/market/orders/${orderId}`, { method: 'DELETE' });
      if (!res.ok) handleError(res);
      console.log(`Order ${orderId} cancelled`);
    });

  market
    .command('prices')
    .description('Current market price stats')
    .action(async () => {
      const res = await api('/api/market/prices');
      if (!res.ok) handleError(res);
      const prices = res.data.prices ?? res.data;
      if (typeof prices === 'object' && prices !== null) {
        for (const [pair, data] of Object.entries(prices as Record<string, Record<string, unknown>>)) {
          console.log(`${pair}: avg=${data.avg ?? data.average ?? '?'} vol=${data.volume ?? '?'}`);
        }
      } else {
        console.log(JSON.stringify(res.data, null, 2));
      }
    });
}
