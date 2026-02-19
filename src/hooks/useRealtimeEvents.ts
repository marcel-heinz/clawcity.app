'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { GameEvent, AgentLeaderboard } from '@/lib/types';

interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  wealth: number;
  reputation: number;
  territory_count: number;
  last_active: string;
  total_gathered?: number;
  // Resource breakdown for expanded view
  gold?: number;
  wood?: number;
  food?: number;
  stone?: number;
  total_gathered_gold?: number;
  total_gathered_wood?: number;
  total_gathered_food?: number;
  total_gathered_stone?: number;
}

interface TopGathererEntry {
  rank: number;
  id: string;
  name: string;
  total_gathered: number;
  total_gathered_gold: number;
  total_gathered_wood: number;
  total_gathered_food: number;
  total_gathered_stone: number;
}

interface RecentlyJoinedEntry {
  id: string;
  name: string;
}

interface WorldStats {
  total_agents: number;
  active_agents: number;
  total_trades: number;
  total_territories: number;
  total_resources: {
    gold: number;
    wood: number;
    food: number;
    stone: number;
  };
  mining_activity_last_hour: number;
  top_gatherer: string | null;
}

interface UseRealtimeEventsReturn {
  events: GameEvent[];
  agents: AgentLeaderboard[];
  leaderboard: LeaderboardEntry[];
  topGatherers: TopGathererEntry[];
  recentlyJoined: RecentlyJoinedEntry[];
  stats: WorldStats;
  isConnected: boolean;
  error: string | null;
}

const defaultStats: WorldStats = {
  total_agents: 0,
  active_agents: 0,
  total_trades: 0,
  total_territories: 0,
  total_resources: { gold: 0, wood: 0, food: 0, stone: 0 },
  mining_activity_last_hour: 0,
  top_gatherer: null,
};

const POLLING_INTERVAL = 5000; // 5 seconds

export function useRealtimeEvents(maxEvents: number = 50): UseRealtimeEventsReturn {
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [agents, setAgents] = useState<AgentLeaderboard[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [topGatherers, setTopGatherers] = useState<TopGathererEntry[]>([]);
  const [recentlyJoined, setRecentlyJoined] = useState<RecentlyJoinedEntry[]>([]);
  const [stats, setStats] = useState<WorldStats>(defaultStats);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isVisibleRef = useRef(true);

  // Fetch data from API
  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(`/api/world/status?limit=${maxEvents}&agent_limit=1000`);
      const data = await response.json();
      
      if (data.success) {
        setEvents(data.data.events || []);
        setAgents(data.data.agents || []);
        setLeaderboard(data.data.leaderboard || []);
        setTopGatherers(data.data.topGatherers || []);
        setRecentlyJoined(data.data.recentlyJoined || []);
        setStats(data.data.stats || defaultStats);
        setIsConnected(true);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch data');
        setIsConnected(false);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to connect to server');
      setIsConnected(false);
    }
  }, [maxEvents]);

  // Start polling
  const startPolling = useCallback(() => {
    if (intervalRef.current) return; // Already polling
    
    intervalRef.current = setInterval(() => {
      if (isVisibleRef.current) {
        fetchData();
      }
    }, POLLING_INTERVAL);
  }, [fetchData]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchData();
    
    // Start polling
    startPolling();

    // Handle visibility change - pause polling when tab is hidden
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible';
      
      if (isVisibleRef.current) {
        // Tab became visible - fetch immediately and resume polling
        fetchData();
        startPolling();
      } else {
        // Tab hidden - stop polling to save resources
        stopPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchData, startPolling, stopPolling]);

  return { events, agents, leaderboard, topGatherers, recentlyJoined, stats, isConnected, error };
}
