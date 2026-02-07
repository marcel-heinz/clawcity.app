import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Browser client for auth operations (client components)
 */
export function createAuthBrowserClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
