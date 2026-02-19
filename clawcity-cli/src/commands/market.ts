import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';
import { extractMarketOrderId, formatMarketPricesLines } from '../lib/formatters.js';

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatOrderLine(order: Record<string, unknown>): string {
  const remainingOffer = asNumber(order.remaining_offer) ?? asNumber(order.offer_amount) ?? 0;
  const remainingRequest = asNumber(order.remaining_request) ?? asNumber(order.request_amount) ?? 0;
  const offerResource = asString(order.offer_resource) || '?';
  const requestResource = asString(order.request_resource) || '?';
  const rate = typeof order.exchange_rate === 'number' ? order.exchange_rate.toFixed(2) : '?';
  const id = asString(order.id) || '?';
  const by = asString(order.agent_name) || asString(order.creator) || 'Unknown';

  return (
    `${offerResource}:${remainingOffer} -> ${requestResource}:${remainingRequest} | ` +
    `filler pays ${remainingRequest} ${requestResource} to receive ${remainingOffer} ${offerResource} | ` +
    `rate:${rate} ${requestResource}/${offerResource} | by ${by} | ${id}`
  );
}

async function listOrders(opts: { offer?: string; request?: string; json?: boolean }) {
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
  if (!Array.isArray(orders)) {
    console.log(JSON.stringify(res.data, null, 2));
    return;
  }
  if (orders.length === 0) {
    console.log('No orders found');
    return;
  }

  for (const order of orders) {
    console.log(formatOrderLine(order));
  }
}

export function registerMarketCommands(program: Command) {
  const market = program
    .command('market')
    .description('Global market order book')
    .option('-o, --offer <resource>', 'Filter by offer resource')
    .option('-r, --request <resource>', 'Filter by request resource')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { offer?: string; request?: string; json?: boolean }) => {
      await listOrders(opts);
    });

  market
    .command('list')
    .description('List market orders')
    .option('-o, --offer <resource>', 'Filter by offer resource')
    .option('-r, --request <resource>', 'Filter by request resource')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { offer?: string; request?: string; json?: boolean }) => {
      await listOrders(opts);
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
      const offerAmount = asNumber(d.remaining_offer) ?? asNumber(d.offer_amount) ?? 0;
      const requestAmount = asNumber(d.remaining_request) ?? asNumber(d.request_amount) ?? 0;
      const offerResource = asString(d.offer_resource) || '?';
      const requestResource = asString(d.request_resource) || '?';
      const offer = `${offerResource}:${offerAmount}`;
      const request = `${requestResource}:${requestAmount}`;
      const rate = typeof d.exchange_rate === 'number' ? d.exchange_rate.toFixed(2) : '?';
      console.log(`${offer} -> ${request} | rate:${rate} | by ${d.agent_name || 'Unknown'} | status:${d.status || '?'}`);
      console.log(`Filler direction: pay ${requestAmount} ${requestResource} to receive ${offerAmount} ${offerResource}`);
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
    .description('Fill a market order (preview first; use --yes to execute in interactive shells)')
    .option('-a, --amount <n>', 'Partial fill amount')
    .option('--expect-pay <resource>', 'Guard: abort unless fill requires paying this resource')
    .option('--expect-receive <resource>', 'Guard: abort unless fill receives this resource')
    .option('--preview', 'Preview fill direction/amount without executing')
    .option('-y, --yes', 'Execute fill after preview in interactive shells')
    .action(async (
      orderId: string,
      opts: {
        amount?: string;
        expectPay?: string;
        expectReceive?: string;
        preview?: boolean;
        yes?: boolean;
      },
    ) => {
      const parsedAmount = parseAmount(opts.amount);
      if (opts.amount && !parsedAmount) {
        console.error('Error: --amount must be a positive integer');
        process.exit(1);
      }

      const previewBody: Record<string, unknown> = {
        order_id: orderId,
        preview: true,
      };
      if (parsedAmount) previewBody.amount = parsedAmount;
      if (opts.expectPay) previewBody.expect_pay_resource = opts.expectPay.toLowerCase();
      if (opts.expectReceive) previewBody.expect_receive_resource = opts.expectReceive.toLowerCase();

      const previewRes = await api('/api/market/orders/fill', { method: 'POST', body: previewBody });
      if (!previewRes.ok) handleError(previewRes);

      const preview = (previewRes.data.preview ?? previewRes.data) as Record<string, unknown>;
      const pay = (preview.pay && typeof preview.pay === 'object')
        ? preview.pay as Record<string, unknown>
        : {};
      const receive = (preview.receive && typeof preview.receive === 'object')
        ? preview.receive as Record<string, unknown>
        : {};

      const payAmount = asNumber(pay.amount) ?? 0;
      const payResource = asString(pay.resource) || '?';
      const receiveAmount = asNumber(receive.amount) ?? 0;
      const receiveResource = asString(receive.resource) || '?';
      console.log(`Fill preview | You pay ${payAmount} ${payResource} -> receive ${receiveAmount} ${receiveResource}`);

      if (opts.preview) {
        return;
      }

      const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
      if (isInteractive && !opts.yes) {
        console.error('Not executed. Re-run with --yes to confirm this fill.');
        process.exit(1);
      }

      const fillBody: Record<string, unknown> = { order_id: orderId };
      if (parsedAmount) fillBody.amount = parsedAmount;
      if (opts.expectPay) fillBody.expect_pay_resource = opts.expectPay.toLowerCase();
      if (opts.expectReceive) fillBody.expect_receive_resource = opts.expectReceive.toLowerCase();

      const res = await api('/api/market/orders/fill', { method: 'POST', body: fillBody });
      if (!res.ok) handleError(res);
      const tx = (res.data.transaction && typeof res.data.transaction === 'object')
        ? res.data.transaction as Record<string, unknown>
        : null;
      if (tx) {
        const gave = (tx.gave && typeof tx.gave === 'object') ? tx.gave as Record<string, unknown> : {};
        const got = (tx.received && typeof tx.received === 'object') ? tx.received as Record<string, unknown> : {};
        console.log(
          `Order ${orderId} filled | paid ${asNumber(gave.amount) ?? '?'} ${asString(gave.resource) || '?'} | ` +
          `received ${asNumber(got.amount) ?? '?'} ${asString(got.resource) || '?'}`
        );
        return;
      }
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
