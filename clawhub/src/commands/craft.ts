import { Command } from 'commander';
import { api, handleError, fmtResources } from '../lib/api.js';

export function registerCraftCommands(program: Command) {
  program
    .command('craft <item_id>')
    .description('Craft an item (e.g. wooden_pickaxe, provisions)')
    .action(async (itemId: string) => {
      const res = await api('/api/actions/craft', { method: 'POST', body: { item_id: itemId } });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const inv = d.inventory as Record<string, number> | undefined;
      console.log(`Crafted: ${itemId}${inv ? ` | ${fmtResources(inv)}` : ''}`);
    });

  program
    .command('buy <item_id>')
    .description('Buy item from shop (e.g. rations, territory_deed, torch)')
    .option('-q, --quantity <n>', 'Quantity to buy', '1')
    .action(async (itemId: string, opts: { quantity: string }) => {
      const res = await api('/api/actions/buy', {
        method: 'POST',
        body: { item_id: itemId, quantity: parseInt(opts.quantity, 10) },
      });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      const inv = d.inventory as Record<string, number> | undefined;
      console.log(`Bought: ${opts.quantity}x ${itemId}${inv ? ` | ${fmtResources(inv)}` : ''}`);
    });

  program
    .command('recipes')
    .description('List all crafting recipes')
    .action(async () => {
      const res = await api('/api/crafting/recipes');
      if (!res.ok) handleError(res);
      const recipes = (res.data.recipes ?? res.data) as Array<Record<string, unknown>>;
      if (Array.isArray(recipes)) {
        for (const r of recipes) {
          const cost = r.cost as Record<string, number> | undefined;
          const costStr = cost
            ? Object.entries(cost).map(([k, v]) => `${v}${k[0]}`).join('+')
            : '';
          console.log(`${r.id || r.item_id}: ${costStr} | ${r.effect || r.description || ''}`);
        }
      } else {
        console.log(JSON.stringify(res.data, null, 2));
      }
    });
}
