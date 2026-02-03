#!/usr/bin/env node
/**
 * Script to regenerate world tiles via the admin API
 * Usage: node scripts/regenerate-tiles.mjs
 */

const ADMIN_KEY = process.env.ADMIN_KEY;
const BASE_URL = process.env.BASE_URL || 'https://www.clawcity.app';

async function regenerateTiles() {
  console.log('🗺️  Regenerating world tiles...');
  console.log(`   URL: ${BASE_URL}/api/world/tiles`);
  
  try {
    if (!ADMIN_KEY) {
      throw new Error('ADMIN_KEY is required. Set it in your environment.');
    }
    const response = await fetch(`${BASE_URL}/api/world/tiles`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      console.log('✅ Success!', data.data);
    } else {
      console.error('❌ Error:', data);
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
}

regenerateTiles();
