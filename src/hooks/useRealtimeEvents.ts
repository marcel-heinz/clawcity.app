'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
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

export function useRealtimeEvents(maxEvents: number = 50): UseRealtimeEventsReturn {
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [agents, setAgents] = useState<AgentLeaderboard[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [topGatherers, setTopGatherers] = useState<TopGathererEntry[]>([]);
  const [recentlyJoined, setRecentlyJoined] = useState<RecentlyJoinedEntry[]>([]);
  const [stats, setStats] = useState<WorldStats>(defaultStats);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial data
  const fetchInitialData = useCallback(async () => {
    try {
      const response = await fetch('/api/world/status?limit=' + maxEvents);
      const data = await response.json();
      
      if (data.success) {
        setEvents(data.data.events || []);
        setAgents(data.data.agents || []);
        setLeaderboard(data.data.leaderboard || []);
        setTopGatherers(data.data.topGatherers || []);
        setRecentlyJoined(data.data.recentlyJoined || []);
        setStats(data.data.stats || defaultStats);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch initial data');
      }
    } catch (err) {
      console.error('Error fetching initial data:', err);
      setError('Failed to connect to server');
    }
  }, [maxEvents]);

  useEffect(() => {
    // Fetch initial data
    fetchInitialData();

    // Set up realtime subscription for events
    const eventsChannel = supabase
      .channel('events-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'events',
        },
        async (payload) => {
          const newEvent = payload.new as GameEvent;
          
          // Fetch agent name for the event
          const { data: agent } = await supabase
            .from('agents')
            .select('name')
            .eq('id', newEvent.agent_id)
            .single();
          
          const enrichedEvent = {
            ...newEvent,
            agent_name: agent?.name || 'Unknown',
          };

          setEvents((prev) => {
            const updated = [enrichedEvent, ...prev];
            return updated.slice(0, maxEvents);
          });

          // Update stats for join events
          if (newEvent.type === 'join') {
            setStats((prev) => ({
              ...prev,
              total_agents: prev.total_agents + 1,
              active_agents: prev.active_agents + 1,
            }));
          }

          // Update stats for trade events
          if (newEvent.type === 'trade') {
            setStats((prev) => ({
              ...prev,
              total_trades: prev.total_trades + 1,
            }));
          }

          // Update mining activity for gather events
          if (newEvent.type === 'gather') {
            setStats((prev) => ({
              ...prev,
              mining_activity_last_hour: prev.mining_activity_last_hour + 1,
            }));
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
        if (status === 'CHANNEL_ERROR') {
          setError('Failed to connect to realtime updates');
        }
      });

    // Set up realtime subscription for agents (position updates)
    const agentsChannel = supabase
      .channel('agents-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agents',
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newAgent = payload.new as AgentLeaderboard;
            setAgents((prev) => [...prev, newAgent]);
          } else if (payload.eventType === 'UPDATE') {
            const updatedAgent = payload.new as AgentLeaderboard;
            setAgents((prev) =>
              prev.map((a) => (a.id === updatedAgent.id ? { ...a, ...updatedAgent } : a))
            );
          } else if (payload.eventType === 'DELETE') {
            const deletedAgent = payload.old as AgentLeaderboard;
            setAgents((prev) => prev.filter((a) => a.id !== deletedAgent.id));
          }
        }
      )
      .subscribe();

    // Cleanup subscriptions on unmount
    return () => {
      supabase.removeChannel(eventsChannel);
      supabase.removeChannel(agentsChannel);
    };
  }, [fetchInitialData, maxEvents]);

  return { events, agents, leaderboard, topGatherers, recentlyJoined, stats, isConnected, error };
}
