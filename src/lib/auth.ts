import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from './supabase';
import { Agent } from './types';

export interface AuthResult {
  success: boolean;
  agent?: Agent;
  error?: string;
}

/**
 * Authenticate an agent from the request headers
 * Expects: Authorization: Bearer <api_key>
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
    
    const { data: agent, error } = await supabase
      .from('agents')
      .select('*')
      .eq('api_key', apiKey)
      .single();

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
