import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { MarketResource, MarketPairStats, ALL_RESOURCES } from '@/lib/types';

// GET - Get market prices and statistics (public)
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const supabase = createServerClient();
    const url = new URL(request.url);
    const offerResource = url.searchParams.get('offer') as MarketResource | null;
    const requestResource = url.searchParams.get('request') as MarketResource | null;

    // Get all open orders
    const { data: orders } = await supabase
      .from('market_orders')
      .select('offer_resource, request_resource, offer_amount, request_amount, filled_amount')
      .eq('status', 'open');

    // Calculate stats per trading pair
    const pairStats: Record<string, MarketPairStats> = {};
    
    for (const order of orders || []) {
      const remaining = order.offer_amount - order.filled_amount;
      if (remaining <= 0) continue;
      
      const pairKey = `${order.offer_resource}→${order.request_resource}`;
      
      if (!pairStats[pairKey]) {
        pairStats[pairKey] = {
          offer_resource: order.offer_resource,
          request_resource: order.request_resource,
          order_count: 0,
          total_offer_available: 0,
          best_rate: null,
          avg_rate: null,
          recent_transactions: [],
        };
      }
      
      const rate = order.request_amount / order.offer_amount;
      pairStats[pairKey].order_count++;
      pairStats[pairKey].total_offer_available += remaining;
      
      // Best rate = lowest request per offer (best deal for someone filling)
      if (pairStats[pairKey].best_rate === null || rate < pairStats[pairKey].best_rate!) {
        pairStats[pairKey].best_rate = rate;
      }
    }

    // Calculate average rates
    for (const pair of Object.values(pairStats)) {
      if (pair.order_count > 0 && pair.total_offer_available > 0) {
        // Re-calculate from orders for accuracy
        const pairOrders = (orders || []).filter(
          o => o.offer_resource === pair.offer_resource && 
               o.request_resource === pair.request_resource &&
               (o.offer_amount - o.filled_amount) > 0
        );
        const totalRate = pairOrders.reduce((sum, o) => sum + (o.request_amount / o.offer_amount), 0);
        pair.avg_rate = totalRate / pairOrders.length;
      }
    }

    // Get recent transactions (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentTx } = await supabase
      .from('market_transactions')
      .select('*')
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false })
      .limit(50);

    // Add recent transactions to each pair
    for (const tx of recentTx || []) {
      const pairKey = `${tx.offer_resource}→${tx.request_resource}`;
      if (pairStats[pairKey]) {
        pairStats[pairKey].recent_transactions.push(tx);
      }
    }

    // Filter by requested pair if specified
    let result = Object.values(pairStats);
    if (offerResource && ALL_RESOURCES.includes(offerResource)) {
      result = result.filter(p => p.offer_resource === offerResource);
    }
    if (requestResource && ALL_RESOURCES.includes(requestResource)) {
      result = result.filter(p => p.request_resource === requestResource);
    }

    // Count total market activity
    const { count: totalOrders } = await supabase
      .from('market_orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open');

    const { count: totalTransactions } = await supabase
      .from('market_transactions')
      .select('*', { count: 'exact', head: true });

    const { count: transactions24h } = await supabase
      .from('market_transactions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', oneDayAgo);

    // Generate all possible trading pairs for reference
    const allPairs: string[] = [];
    for (const offer of ALL_RESOURCES) {
      for (const request of ALL_RESOURCES) {
        if (offer !== request) {
          allPairs.push(`${offer}→${request}`);
        }
      }
    }

    return jsonResponse({
      success: true,
      data: {
        pairs: result,
        all_possible_pairs: allPairs,
        recent_transactions: recentTx || [],
        stats: {
          open_orders: totalOrders || 0,
          total_transactions: totalTransactions || 0,
          transactions_24h: transactions24h || 0,
          active_trading_pairs: result.length,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Market prices error:', error);
    return errorResponse('Internal server error', 500);
  }
}
