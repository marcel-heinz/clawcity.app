#!/usr/bin/env node
/**
 * Script to manage active + staged world generation via admin APIs.
 *
 * Usage:
 *   node scripts/regenerate-tiles.mjs --mode active
 *   node scripts/regenerate-tiles.mjs --mode status
 *   node scripts/regenerate-tiles.mjs --mode prepare-next
 *   node scripts/regenerate-tiles.mjs --mode step-next --repeat 10 --delay-ms 300
 *   node scripts/regenerate-tiles.mjs --mode prepare-and-step-next --force
 */

const ADMIN_KEY = process.env.ADMIN_KEY;
const BASE_URL = process.env.BASE_URL || 'https://www.clawcity.app';

function parseArgs(argv) {
  const args = {
    mode: 'step-next',
    force: false,
    repeat: 1,
    delayMs: 300,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === '--mode' && next) {
      args.mode = next;
      i++;
      continue;
    }
    if (token === '--force') {
      args.force = true;
      continue;
    }
    if (token === '--repeat' && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) {
        args.repeat = Math.floor(n);
      }
      i++;
      continue;
    }
    if (token === '--delay-ms' && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n >= 0) {
        args.delayMs = Math.floor(n);
      }
      i++;
      continue;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runActiveReset() {
  console.log('🗺️  Regenerating ACTIVE world tiles...');
  console.log(`   URL: ${BASE_URL}/api/world/tiles`);

  const response = await fetch(`${BASE_URL}/api/world/tiles`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ADMIN_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  return response;
}

async function runGenerationAction(action, force) {
  const response = await fetch(`${BASE_URL}/api/world/generation`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ADMIN_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, force }),
  });

  return response;
}

async function runStatus() {
  const response = await fetch(`${BASE_URL}/api/world/generation`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${ADMIN_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  return response;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!ADMIN_KEY) {
    throw new Error('ADMIN_KEY is required. Set it in your environment.');
  }

  console.log(`Mode: ${options.mode}`);
  console.log(`Base URL: ${BASE_URL}`);

  if (options.mode === 'active') {
    const response = await runActiveReset();
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(`Active reset failed: ${JSON.stringify(data)}`);
    }
    console.log('✅ Active world regenerated:', data.data);
    return;
  }

  if (options.mode === 'status') {
    const response = await runStatus();
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(`Status fetch failed: ${JSON.stringify(data)}`);
    }
    console.log('✅ World status:', JSON.stringify(data.data, null, 2));
    return;
  }

  let action = null;
  if (options.mode === 'prepare-next') action = 'prepare';
  if (options.mode === 'step-next') action = 'step';
  if (options.mode === 'prepare-and-step-next') action = 'prepare_and_step';

  if (!action) {
    throw new Error('Invalid --mode. Use: active | status | prepare-next | step-next | prepare-and-step-next');
  }

  for (let i = 0; i < options.repeat; i++) {
    const response = await runGenerationAction(action, options.force);
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(`Generation action failed at iteration ${i + 1}: ${JSON.stringify(data)}`);
    }
    console.log(`✅ Iteration ${i + 1}/${options.repeat}:`, data.data);

    if (i < options.repeat - 1 && options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }
}

main().catch((error) => {
  console.error('❌', error.message);
  process.exit(1);
});
