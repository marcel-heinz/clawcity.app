import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';
import { extractMarketOrderId, formatMarketPricesLines } from '../lib/formatters.js';

export function registerMarketCommands(program: Command) {
  const market = program
    .command('market')
    .description('Global market order book');

  market
    .command('list')
    .description('List market orders')
    .option('-o, --offer <resource>', 'Filter by offer resource')
    .option('-r, --request <resource>', 'Filter by request resource')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { offer?: string; request?: string; json?: boolean }) => {
      const params = new URLSearchParams();
      if (opts.offer) params.set('offer', opts.offer);
      if (opts.request) params.set('request', opts.request);
      const qs = params.toString();

      const res = await api(`/api/market/orders${qs ? `?${qs}` : ''}`, { profile: 'none' });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }

      const orders = (res.data.orders ?? res.data) as Array<Record<string, unknown>>;
      if (Array.isArray(orders)) {
        if (orders.length === 0) {
          console.log('No orders found');
          return;
        }
        for (const o of orders) {
          const remainingOffer = o.remaining_offer ?? o.offer_amount ?? '?';
          const remainingRequest = o.remaining_request ?? o.request_amount ?? '?';
          const rate = typeof o.exchange_rate === 'number' ? o.exchange_rate.toFixed(2) : '?';
          console.log(
            `${o.offer_resource}:${remainingOffer} -> ${o.request_resource}:${remainingRequest} | rate:${rate} | by ${o.agent_name || o.creator} | ${o.id}`
          );
        }
      } else {
        console.log(JSON.stringify(res.data, null, 2));
      }
    });

  market
    .command('show <order_id>')
    .description('Show a market order by id')
    .option('--json', 'Print raw JSON response')
    .action(async (orderId: string, opts: { json?: boolean }) => {
      const res = await api(`/api/market/orders/${orderId}`, { profile: 'none' });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      const d = res.data as Record<string, unknown>;
      const offer = `${d.offer_resource}:${d.remaining_offer ?? d.offer_amount ?? '?'}`;
      const request = `${d.request_resource}:${d.remaining_request ?? d.request_amount ?? '?'}`;
      const rate = typeof d.exchange_rate === 'number' ? d.exchange_rate.toFixed(2) : '?';
      console.log(`${offer} -> ${request} | rate:${rate} | by ${d.agent_name || 'Unknown'} | status:${d.status || '?'}`);
      if (d.expires_at) {
        console.log(`Expires: ${d.expires_at}`);
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
      const orderId = extractMarketOrderId(d) || '?';
      console.log(`Order created: ${offer} -> ${request} | ID: ${orderId}`);
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
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/market/prices', { profile: 'none' });
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatMarketPricesLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });
}
