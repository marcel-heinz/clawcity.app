'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { GameEvent, AgentPublic } from '@/lib/types';

interface UseRealtimeEventsReturn {
  events: GameEvent[];
  agents: AgentPublic[];
  stats: {
    total_agents: number;
    active_agents: number;
    total_trades: number;
  };
  isConnected: boolean;
  error: string | null;
}

export function useRealtimeEvents(maxEvents: number = 50): UseRealtimeEventsReturn {
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [agents, setAgents] = useState<AgentPublic[]>([]);
  const [stats, setStats] = useState({
    total_agents: 0,
    active_agents: 0,
    total_trades: 0,
  });
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
        setStats(data.data.stats || { total_agents: 0, active_agents: 0, total_trades: 0 });
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
            const newAgent = payload.new as AgentPublic;
            setAgents((prev) => [...prev, newAgent]);
          } else if (payload.eventType === 'UPDATE') {
            const updatedAgent = payload.new as AgentPublic;
            setAgents((prev) =>
              prev.map((a) => (a.id === updatedAgent.id ? updatedAgent : a))
            );
          } else if (payload.eventType === 'DELETE') {
            const deletedAgent = payload.old as AgentPublic;
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

  return { events, agents, stats, isConnected, error };
}
