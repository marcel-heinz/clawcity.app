import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

type ResourceName = 'gold' | 'wood' | 'food' | 'stone';

interface Requirement {
  need: number;
  have: number;
  missing: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
    : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function parseTarget(rawTarget: string): string {
  return rawTarget.trim().toLowerCase();
}

function formatResourceCost(cost: Record<string, unknown>): string {
  const parts: string[] = [];
  const gold = asNumber(cost.gold);
  const wood = asNumber(cost.wood);
  const food = asNumber(cost.food);
  const stone = asNumber(cost.stone);
  const foodClaimCost = asNumber(cost.food_claim_cost);
  const staminaCost = asNumber(cost.stamina_cost);
  const foodTotal = asNumber(cost.food_total);

  if (gold !== null && gold > 0) parts.push(`${gold} gold`);
  if (wood !== null && wood > 0) parts.push(`${wood} wood`);
  if (stone !== null && stone > 0) parts.push(`${stone} stone`);
  if (food !== null && food > 0) parts.push(`${food} food`);
  if (foodClaimCost !== null) parts.push(`${foodClaimCost} food (claim cost)`);
  if (staminaCost !== null) parts.push(`${staminaCost} food (stamina cost)`);
  if (foodTotal !== null) parts.push(`${foodTotal} food (total)`);

  return parts.length > 0 ? parts.join(', ') : 'no resource cost';
}

function getInventory(stats: Record<string, unknown>): Record<ResourceName, number> {
  return {
    gold: asNumber(stats.gold) || 0,
    wood: asNumber(stats.wood) || 0,
    food: asNumber(stats.food) || 0,
    stone: asNumber(stats.stone) || 0,
  };
}

function buildRequirements(
  inventory: Record<ResourceName, number>,
  cost: Record<string, unknown>,
): Record<ResourceName, Requirement> {
  const toRequirement = (need: number, have: number): Requirement => ({
    need,
    have,
    missing: Math.max(0, need - have),
  });

  return {
    gold: toRequirement(asNumber(cost.gold) || 0, inventory.gold),
    wood: toRequirement(asNumber(cost.wood) || 0, inventory.wood),
    food: toRequirement(asNumber(cost.food) || 0, inventory.food),
    stone: toRequirement(asNumber(cost.stone) || 0, inventory.stone),
  };
}

function missingRequirementLines(requirements: Record<ResourceName, Requirement>): string[] {
  return (Object.entries(requirements) as Array<[ResourceName, Requirement]>)
    .filter(([, requirement]) => requirement.missing > 0)
    .map(([resource, requirement]) => (
      `${resource} +${requirement.missing} (need ${requirement.need}, have ${requirement.have})`
    ));
}

function printReasons(reasons: unknown): void {
  if (!Array.isArray(reasons)) return;
  const parsedReasons = reasons.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  if (parsedReasons.length === 0) return;
  console.log(`Blocked by: ${parsedReasons.join(', ')}`);
}

export function registerPlanningCommands(program: Command): void {
  program
    .command('cost <target>')
    .description('Show costs for claim, upgrade, buildings, and craft/shop items')
    .option('--json', 'Print raw JSON response')
    .action(async (target: string, opts: { json?: boolean }) => {
      const normalizedTarget = parseTarget(target);
      const recipesRes = await api('/api/crafting/recipes', { profile: 'none' });
      if (!recipesRes.ok) handleError(recipesRes);

      const data = recipesRes.data as Record<string, unknown>;
      const info = asRecord(data.info) || {};
      const costs = asRecord(info.costs) || {};
      const claimCost = asRecord(costs.claim);
      const upgradeCost = asRecord(costs.upgrade);
      const buildingCosts = asRecord(costs.buildings) || {};
      const craftable = asRecordArray(data.craftable);
      const shop = asRecordArray(data.shop);

      if (normalizedTarget === 'claim' || normalizedTarget === 'territory') {
        if (!claimCost) {
          console.error('Error: claim cost metadata unavailable');
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(claimCost, null, 2));
          return;
        }
        const baseCost = asRecord(claimCost.base_cost) || {};
        const discounts = asRecord(claimCost.discounts) || {};
        console.log(`Claim cost (base): ${formatResourceCost({
          gold: baseCost.gold,
          wood: baseCost.wood,
          stone: baseCost.stone,
          food_claim_cost: baseCost.food_claim_cost,
          stamina_cost: baseCost.stamina_cost,
          food_total: baseCost.food_total,
        })}`);
        const firstClaimDiscount = asNumber(discounts.first_claim_percent);
        const deedDiscount = asNumber(discounts.territory_deed_percent);
        console.log(
          `Discounts: first claim ${firstClaimDiscount ?? 0}%, territory deed ${deedDiscount ?? 0}%`,
        );
        const note = asString(discounts.first_claim_note);
        if (note) {
          console.log(`Note: ${note}`);
        }
        return;
      }

      if (normalizedTarget === 'upgrade' || normalizedTarget.startsWith('upgrade')) {
        const levels = asRecordArray(upgradeCost?.levels);
        if (levels.length === 0) {
          console.error('Error: upgrade cost metadata unavailable');
          process.exit(1);
        }

        let selectedLevels = levels;
        const levelMatch = normalizedTarget.match(/^upgrade[:_-]?(\d+)$/);
        if (levelMatch) {
          const level = Number(levelMatch[1]);
          selectedLevels = levels.filter((entry) => asNumber(entry.level) === level);
          if (selectedLevels.length === 0) {
            console.error(`Error: Unknown upgrade level ${level}`);
            process.exit(1);
          }
        }

        if (opts.json) {
          console.log(JSON.stringify({
            max_level: asNumber(upgradeCost?.max_level),
            levels: selectedLevels,
          }, null, 2));
          return;
        }

        for (const level of selectedLevels) {
          const levelNumber = asNumber(level.level) || '?';
          const levelCost = asRecord(level.cost) || {};
          const bonusPercent = asNumber(level.territory_gather_bonus_percent);
          console.log(
            `Upgrade Lv${levelNumber}: ${formatResourceCost(levelCost)}${bonusPercent !== null ? ` | bonus +${bonusPercent}%` : ''}`,
          );
        }
        return;
      }

      const building = asRecord(buildingCosts[normalizedTarget]);
      if (building) {
        if (opts.json) {
          console.log(JSON.stringify(building, null, 2));
          return;
        }
        const name = asString(building.name) || normalizedTarget;
        const buildCost = asRecord(building.build_cost) || {};
        const upkeep = asRecord(building.hourly_upkeep) || {};
        console.log(`${name}: build ${formatResourceCost(buildCost)} | upkeep ${formatResourceCost(upkeep)}/hour`);
        const effect = asString(building.effect_description);
        if (effect) {
          console.log(`Effect: ${effect}`);
        }
        return;
      }

      const craftItem = craftable.find((entry) => asString(entry.id)?.toLowerCase() === normalizedTarget);
      if (craftItem) {
        const recipe = asRecord(craftItem.recipe) || {};
        if (opts.json) {
          console.log(JSON.stringify({
            type: 'craft',
            id: asString(craftItem.id),
            name: asString(craftItem.name),
            recipe,
            requires_workshop: craftItem.requires_workshop === true,
          }, null, 2));
          return;
        }
        console.log(
          `${asString(craftItem.name) || normalizedTarget} (${normalizedTarget}) craft cost: ${formatResourceCost(recipe)}`,
        );
        if (craftItem.requires_workshop === true) {
          console.log('Requires workshop: yes');
        }
        return;
      }

      const shopItem = shop.find((entry) => asString(entry.id)?.toLowerCase() === normalizedTarget);
      if (shopItem) {
        const price = asNumber(shopItem.price);
        const payload = {
          gold: price || 0,
        };
        if (opts.json) {
          console.log(JSON.stringify({
            type: 'shop',
            id: asString(shopItem.id),
            name: asString(shopItem.name),
            cost: payload,
          }, null, 2));
          return;
        }
        console.log(`${asString(shopItem.name) || normalizedTarget} (${normalizedTarget}) shop cost: ${formatResourceCost(payload)}`);
        return;
      }

      console.error(`Error: Unknown target "${target}". Use claim, upgrade, building type, or item_id.`);
      process.exit(1);
    });

  program
    .command('afford <target>')
    .description('Check if you can currently afford an action/item and what is missing')
    .option('--json', 'Print raw JSON response')
    .action(async (target: string, opts: { json?: boolean }) => {
      const normalizedTarget = parseTarget(target);
      const [statsRes, recipesRes] = await Promise.all([
        api('/api/agents/me/stats'),
        api('/api/crafting/recipes', { profile: 'none' }),
      ]);

      if (!statsRes.ok) handleError(statsRes);
      if (!recipesRes.ok) handleError(recipesRes);

      const stats = statsRes.data as Record<string, unknown>;
      const inventory = getInventory(stats);
      const eligibility = asRecord(stats.action_eligibility) || {};

      const recipesData = recipesRes.data as Record<string, unknown>;
      const craftable = asRecordArray(recipesData.craftable);
      const shop = asRecordArray(recipesData.shop);

      if (normalizedTarget === 'claim' || normalizedTarget === 'territory') {
        const claim = asRecord(eligibility.claim) || {};
        const result = {
          target: 'claim',
          can_execute: asBoolean(claim.can_execute),
          can_afford: asBoolean(claim.can_afford),
          affordable_now: asBoolean(claim.can_execute) && asBoolean(claim.can_afford),
          reasons: Array.isArray(claim.reasons) ? claim.reasons : [],
          effective_cost: asRecord(claim.effective_cost) || {},
          missing_resources: Array.isArray(claim.missing_resources) ? claim.missing_resources : [],
          requirements: asRecord(claim.requirements) || {},
          current_tile: asRecord(stats.current_tile) || {},
        };
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`Claim here: ${result.affordable_now ? 'YES' : 'NO'}`);
        console.log(`Cost: ${formatResourceCost(result.effective_cost)}`);
        if ((result.missing_resources as unknown[]).length > 0) {
          console.log(`Missing: ${(result.missing_resources as string[]).join('; ')}`);
        }
        printReasons(result.reasons);
        return;
      }

      if (normalizedTarget === 'upgrade') {
        const upgrade = asRecord(eligibility.upgrade) || {};
        const result = {
          target: 'upgrade',
          can_execute: asBoolean(upgrade.can_execute),
          can_afford: asBoolean(upgrade.can_afford),
          affordable_now: asBoolean(upgrade.can_execute) && asBoolean(upgrade.can_afford),
          reasons: Array.isArray(upgrade.reasons) ? upgrade.reasons : [],
          current_level: asNumber(upgrade.current_level),
          next_level: asNumber(upgrade.next_level),
          cost: asRecord(upgrade.cost) || {},
          missing_resources: Array.isArray(upgrade.missing_resources) ? upgrade.missing_resources : [],
          requirements: asRecord(upgrade.requirements) || {},
          current_tile: asRecord(stats.current_tile) || {},
        };
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`Upgrade here: ${result.affordable_now ? 'YES' : 'NO'}`);
        if (result.next_level !== null) {
          console.log(`Next level: Lv${result.next_level}`);
          console.log(`Cost: ${formatResourceCost(result.cost)}`);
        } else {
          console.log('Cost: unavailable (already max level or not upgradeable)');
        }
        if ((result.missing_resources as unknown[]).length > 0) {
          console.log(`Missing: ${(result.missing_resources as string[]).join('; ')}`);
        }
        printReasons(result.reasons);
        return;
      }

      const build = asRecord(eligibility.build) || {};
      const buildOptions = asRecord(build.options) || {};
      const buildOption = asRecord(buildOptions[normalizedTarget]);
      if (buildOption) {
        const canExecute = asBoolean(build.can_execute);
        const canAffordTarget = asBoolean(buildOption.can_afford);
        const result = {
          target: normalizedTarget,
          can_execute: canExecute,
          can_afford: canAffordTarget,
          affordable_now: canExecute && canAffordTarget,
          reasons: Array.isArray(build.reasons) ? build.reasons : [],
          cost: asRecord(buildOption.cost) || {},
          missing_resources: Array.isArray(buildOption.missing_resources) ? buildOption.missing_resources : [],
          requirements: asRecord(buildOption.requirements) || {},
          current_tile: asRecord(stats.current_tile) || {},
        };
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`Build ${normalizedTarget}: ${result.affordable_now ? 'YES' : 'NO'}`);
        console.log(`Cost: ${formatResourceCost(result.cost)}`);
        if ((result.missing_resources as unknown[]).length > 0) {
          console.log(`Missing: ${(result.missing_resources as string[]).join('; ')}`);
        }
        printReasons(result.reasons);
        return;
      }

      const craftItem = craftable.find((entry) => asString(entry.id)?.toLowerCase() === normalizedTarget);
      if (craftItem) {
        const recipe = asRecord(craftItem.recipe) || {};
        const requirements = buildRequirements(inventory, recipe);
        const missing = missingRequirementLines(requirements);
        const requiresWorkshop = craftItem.requires_workshop === true;
        const result = {
          target: normalizedTarget,
          type: 'craft',
          affordable_now: missing.length === 0,
          requires_workshop: requiresWorkshop,
          cost: recipe,
          missing_resources: missing,
          requirements,
          inventory,
        };
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`Craft ${normalizedTarget}: ${result.affordable_now ? 'YES' : 'NO'}`);
        console.log(`Cost: ${formatResourceCost(recipe)}`);
        if (requiresWorkshop) {
          console.log('Requires workshop: yes');
        }
        if (missing.length > 0) {
          console.log(`Missing: ${missing.join('; ')}`);
        }
        return;
      }

      const shopItem = shop.find((entry) => asString(entry.id)?.toLowerCase() === normalizedTarget);
      if (shopItem) {
        const price = asNumber(shopItem.price) || 0;
        const cost = { gold: price };
        const requirements = buildRequirements(inventory, cost);
        const missing = missingRequirementLines(requirements);
        const result = {
          target: normalizedTarget,
          type: 'shop',
          affordable_now: missing.length === 0,
          cost,
          missing_resources: missing,
          requirements,
          inventory,
        };
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`Buy ${normalizedTarget}: ${result.affordable_now ? 'YES' : 'NO'}`);
        console.log(`Cost: ${formatResourceCost(cost)}`);
        if (missing.length > 0) {
          console.log(`Missing: ${missing.join('; ')}`);
        }
        return;
      }

      console.error(`Error: Unknown target "${target}". Use claim, upgrade, building type, or item_id.`);
      process.exit(1);
    });

  program
    .command('territories')
    .description('List your owned territories with upgrade/building details')
    .option('--json', 'Print raw JSON response')
    .action(async (opts: { json?: boolean }) => {
      const res = await api('/api/agents/me', {
        query: { fields: 'territories,position' },
      });
      if (!res.ok) handleError(res);
      const data = res.data as Record<string, unknown>;
      const territories = asRecordArray(data.territories);

      if (opts.json) {
        console.log(JSON.stringify({
          count: territories.length,
          territories,
        }, null, 2));
        return;
      }

      if (territories.length === 0) {
        console.log('No territories owned.');
        return;
      }

      for (const territory of territories) {
        const x = asNumber(territory.x);
        const y = asNumber(territory.y);
        const terrain = asString(territory.terrain) || 'unknown';
        const level = asNumber(territory.upgrade_level) || 1;
        const buildingType = asString(territory.building_type);
        console.log(
          `(${x ?? '?'},${y ?? '?'}) ${terrain} | Lv${level}${buildingType ? ` | building:${buildingType}` : ''}`,
        );
      }
      console.log(`Total territories: ${territories.length}`);
    });
}
