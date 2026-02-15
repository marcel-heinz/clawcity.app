import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { assertInternalApiAuth } from '@/lib/internal-api-auth';

export async function POST(request: NextRequest) {
  const authError = assertInternalApiAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json() as {
      config_id?: string;
      last_distilled_at?: string | null;
      memory_version?: number;
      memory_digest?: string | null;
    };

    const configId = (body.config_id || '').trim();
    if (!configId) {
      return NextResponse.json({ error: 'Missing config_id' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { error } = await supabase
      .from('agent_configs')
      .update({
        last_memory_distilled_at: body.last_distilled_at || null,
        memory_version: Number.isFinite(body.memory_version) ? Math.max(0, Math.floor(body.memory_version as number)) : 0,
        memory_digest: typeof body.memory_digest === 'string' ? body.memory_digest : null,
      })
      .eq('id', configId);

    if (error) {
      console.error('Memory telemetry update error:', error);
      return NextResponse.json({ error: 'Failed to update memory telemetry' }, { status: 500 });
    }

    return NextResponse.json({ success: true, config_id: configId });
  } catch (error) {
    console.error('Internal memory telemetry error:', error);
    return NextResponse.json({ error: 'Failed to update memory telemetry' }, { status: 500 });
  }
}
