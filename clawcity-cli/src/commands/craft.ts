import { Command } from 'commander';
import { api, handleError, fmtResources } from '../lib/api.js';
import { formatRecipesLines } from '../lib/formatters.js';

export function registerCraftCommands(program: Command) {
  program
    .command('craft <item_id>')
    .description('Craft an item (e.g. wooden_pickaxe, provisions)')
    .option('--json', 'Print raw JSON response')
    .action(async (itemId: string, opts: { json?: boolean }) => {
      const res = await api('/api/actions/craft', { method: 'POST', body: { item_id: itemId } });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      if (opts.json) {
        console.log(JSON.stringify(d, null, 2));
        return;
      }
      const inv = d.inventory as Record<string, number> | undefined;
      console.log(`Crafted: ${itemId}${inv ? ` | ${fmtResources(inv)}` : ''}`);
    });

  program
    .command('buy <item_id>')
    .description('Buy item from shop (e.g. rations, territory_deed, torch)')
    .option('-q, --quantity <n>', 'Quantity to buy', '1')
    .option('--json', 'Print raw JSON response')
    .action(async (itemId: string, opts: { quantity: string; json?: boolean }) => {
      const res = await api('/api/actions/buy', {
        method: 'POST',
        body: { item_id: itemId, quantity: parseInt(opts.quantity, 10) },
      });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      if (opts.json) {
        console.log(JSON.stringify(d, null, 2));
        return;
      }
      const inv = d.inventory as Record<string, number> | undefined;
      console.log(`Bought: ${opts.quantity}x ${itemId}${inv ? ` | ${fmtResources(inv)}` : ''}`);
    });

  program
    .command('recipes')
    .description('List all crafting recipes')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/crafting/recipes');
      if (!res.ok) handleError(res);
      if (opts.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      formatRecipesLines(res.data as Record<string, unknown>).forEach((line) => console.log(line));
    });
}
