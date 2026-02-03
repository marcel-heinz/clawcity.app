#!/usr/bin/env node

/**
 * ClawCity Admin Agent Movement Script
 * Moves the admin agent around the map at full speed for at least 60 seconds
 */

const API_BASE = 'https://www.clawcity.app';
const API_KEY = 'clawcity_PtTntHY9qsdKSHttP-IXEhyHAYqKCOO1';
const AGENT_NAME = 'ClawCity_Admin';
const DIRECTIONS = ['north', 'south', 'east', 'west'];
const DURATION_MS = 65000; // 65 seconds to be safe
const MOVE_INTERVAL_MS = 260; // Slightly above 250ms cooldown to avoid rate limits

let moveCount = 0;
let successfulMoves = 0;
let failedMoves = 0;
let currentPosition = { x: 270, y: 417 }; // Starting position from credentials

async function move(direction) {
  try {
    const response = await fetch(`${API_BASE}/api/actions/move`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ direction }),
    });

    const data = await response.json();
    moveCount++;

    if (data.success) {
      successfulMoves++;
      if (data.data?.position) {
        currentPosition = data.data.position;
      }
      const moved = data.data?.moved !== false;
      console.log(`[${moveCount}] ${moved ? '✅' : '🚫'} Moved ${direction} → (${currentPosition.x}, ${currentPosition.y})${!moved ? ' (edge)' : ''}`);
    } else {
      failedMoves++;
      console.log(`[${moveCount}] ❌ Failed: ${data.error || 'Unknown error'}`);
    }

    return data;
  } catch (error) {
    failedMoves++;
    moveCount++;
    console.log(`[${moveCount}] ❌ Network error: ${error.message}`);
    return null;
  }
}

function getRandomDirection() {
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
}

// More interesting movement pattern - explore in a semi-random way
let lastDirection = null;
function getSmartDirection() {
  // 70% chance to continue in same direction (exploration)
  // 30% chance to change direction
  if (lastDirection && Math.random() < 0.7) {
    return lastDirection;
  }
  
  // Avoid going back immediately
  const opposite = {
    'north': 'south',
    'south': 'north',
    'east': 'west',
    'west': 'east',
  };
  
  let newDir;
  do {
    newDir = getRandomDirection();
  } while (lastDirection && newDir === opposite[lastDirection] && Math.random() < 0.5);
  
  lastDirection = newDir;
  return newDir;
}

async function getAgentStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/agents/me`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    });
    const data = await response.json();
    if (data.success) {
      currentPosition = { x: data.data.x, y: data.data.y };
      console.log(`📍 Current position: (${currentPosition.x}, ${currentPosition.y})`);
      console.log(`💰 Resources: ${data.data.gold} gold, ${data.data.wood} wood, ${data.data.food} food, ${data.data.stone} stone`);
    }
    return data;
  } catch (error) {
    console.log(`⚠️ Could not get agent status: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('🦀 ClawCity Admin Movement Script');
  console.log('================================');
  console.log(`Agent: ${AGENT_NAME}`);
  console.log(`Duration: ${DURATION_MS / 1000} seconds`);
  console.log(`Move interval: ${MOVE_INTERVAL_MS}ms`);
  console.log('');

  // Get initial status
  await getAgentStatus();
  console.log('');
  console.log('🚀 Starting movement...');
  console.log('');

  const startTime = Date.now();
  const endTime = startTime + DURATION_MS;

  while (Date.now() < endTime) {
    const direction = getSmartDirection();
    await move(direction);
    
    // Wait for cooldown
    const elapsed = Date.now() - startTime;
    const remaining = Math.ceil((endTime - Date.now()) / 1000);
    
    // Show progress every 10 moves
    if (moveCount % 10 === 0) {
      console.log(`--- ${remaining}s remaining ---`);
    }
    
    await new Promise(resolve => setTimeout(resolve, MOVE_INTERVAL_MS));
  }

  const totalTime = (Date.now() - startTime) / 1000;

  console.log('');
  console.log('================================');
  console.log('🏁 Movement complete!');
  console.log(`Total time: ${totalTime.toFixed(1)}s`);
  console.log(`Total moves attempted: ${moveCount}`);
  console.log(`Successful moves: ${successfulMoves}`);
  console.log(`Failed moves: ${failedMoves}`);
  console.log(`Success rate: ${((successfulMoves / moveCount) * 100).toFixed(1)}%`);
  console.log('');

  // Get final status
  await getAgentStatus();
}

main().catch(console.error);
