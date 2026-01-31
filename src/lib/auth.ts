import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from './supabase';
import { Agent } from './types';
import { hashToken } from './game-logic';

export interface AuthResult {
  success: boolean;
  agent?: Agent;
  error?: string;
}

/**
 * Authenticate an agent from the request headers
 * Expects: Authorization: Bearer <api_key>
 * 
 * Supports both:
 * - Hash-based lookup (secure, for new agents)
 * - Legacy plaintext lookup (for backwards compatibility)
 */
export async function authenticateAgent(request: NextRequest): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Database not configured. Please set up Supabase.' };
  }

  const authHeader = request.headers.get('authorization');
  
  if (!authHeader) {
    return { success: false, error: 'Missing authorization header' };
  }

  const [type, apiKey] = authHeader.split(' ');
  
  if (type !== 'Bearer' || !apiKey) {
    return { success: false, error: 'Invalid authorization format. Use: Bearer <api_key>' };
  }

  try {
    const supabase = createServerClient();
    
    // First, try hash-based lookup (secure method for new agents)
    const apiKeyHash = hashToken(apiKey);
    let { data: agent, error } = await supabase
      .from('agents')
      .select('*')
      .eq('api_key_hash', apiKeyHash)
      .single();

    // If hash lookup fails, fall back to legacy plaintext lookup
    // This allows existing agents to continue working during migration
    if (error || !agent) {
      const legacyResult = await supabase
        .from('agents')
        .select('*')
        .eq('api_key', apiKey)
        .single();
      
      agent = legacyResult.data;
      error = legacyResult.error;
      
      // If legacy lookup succeeds, migrate to hash-based auth (ignore errors if column doesn't exist)
      if (agent && !agent.api_key_hash) {
        supabase
          .from('agents')
          .update({ api_key_hash: apiKeyHash })
          .eq('id', agent.id)
          .then(() => {})
          .catch(() => {}); // Ignore errors - migration is optional
      }
    }

    if (error || !agent) {
      return { success: false, error: 'Invalid API key' };
    }

    return { success: true, agent: agent as Agent };
  } catch (error) {
    console.error('Auth error:', error);
    return { success: false, error: 'Authentication failed' };
  }
}

/**
 * Create a JSON response
 */
export function jsonResponse<T>(
  data: T,
  status: number = 200
): Response {
  return Response.json(data, { status });
}

/**
 * Create an error response
 */
export function errorResponse(error: string, status: number = 400): Response {
  return Response.json({ success: false, error }, { status });
}
