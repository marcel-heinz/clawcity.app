import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Check if Supabase is configured
export const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

// Client for browser usage - create a placeholder if not configured
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key', {
      auth: { persistSession: false },
    });

// Server client for API routes (uses service role key for admin access)
export function createServerClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.'
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (serviceRoleKey) {
    return createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  
  // Fallback to anon key if service role not available
  return createClient(supabaseUrl, supabaseAnonKey);
}

// Database types for Supabase
export type Database = {
  public: {
    Tables: {
      agents: {
        Row: {
          id: string;
          name: string;
          api_key: string;
          x: number;
          y: number;
          gold: number;
          wood: number;
          food: number;
          stone: number;
          reputation: number;
          created_at: string;
          last_active: string;
        };
        Insert: Omit<Database['public']['Tables']['agents']['Row'], 'id' | 'created_at' | 'last_active'> & {
          id?: string;
          created_at?: string;
          last_active?: string;
        };
        Update: Partial<Database['public']['Tables']['agents']['Row']>;
      };
      tiles: {
        Row: {
          x: number;
          y: number;
          terrain: string;
          resources: Record<string, number>;
        };
        Insert: Database['public']['Tables']['tiles']['Row'];
        Update: Partial<Database['public']['Tables']['tiles']['Row']>;
      };
      events: {
        Row: {
          id: number;
          agent_id: string;
          type: string;
          data: Record<string, unknown>;
          location: { x: number; y: number };
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['events']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['events']['Row']>;
      };
      trades: {
        Row: {
          id: string;
          from_agent_id: string;
          to_agent_id: string;
          offer: Record<string, number>;
          request: Record<string, number>;
          status: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['trades']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['trades']['Row']>;
      };
    };
  };
};
