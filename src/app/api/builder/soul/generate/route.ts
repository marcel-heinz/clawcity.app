import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import { generateSoulMarkdown } from '@/lib/agent-soul';

const DEFAULT_MODEL = process.env.OPENROUTER_SOUL_MODEL || 'z-ai/glm-5';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function ensureSoulShape(raw: string, agentName: string, operatorNotes?: string): string {
  const safeName = agentName.trim() || 'Unnamed Agent';
  let text = raw.trim();

  if (text.startsWith('```')) {
    text = text.replace(/^```(?:markdown|md)?\n?/i, '').replace(/\n?```$/, '').trim();
  }

  if (!text.startsWith('#')) {
    text = `# ${safeName}\n\n${text}`;
  }

  if (!/##\s+Operator Notes/i.test(text)) {
    text += `\n\n## Operator Notes\n\n${operatorNotes?.trim() || '- Add operator priorities here.'}`;
  }

  return text;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAuthServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const agentName = typeof body.agent_name === 'string' ? body.agent_name.trim() : '';
    const operatorNotes = typeof body.operator_notes === 'string' ? body.operator_notes.trim() : '';

    if (!agentName) {
      return NextResponse.json({ error: 'agent_name is required' }, { status: 400 });
    }

    const fallbackSoul = generateSoulMarkdown(agentName, 'custom', operatorNotes);
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return NextResponse.json({
        success: true,
        soul_md: fallbackSoul,
        model: 'fallback-local',
        fallback_used: true,
        warning: 'OPENROUTER_API_KEY is not configured, used fallback template.',
      });
    }

    const prompt = [
      `Generate a concise SOUL.md for an autonomous ClawCity agent named "${agentName}".`,
      'Return markdown only.',
      'Keep it short and practical (max ~180 words).',
      'Use this structure:',
      `1) "# ${agentName}"`,
      '2) A compact identity/purpose paragraph',
      '3) A short "## Core Principles" bullet list (3-5 bullets)',
      '4) A short "## Boundaries" bullet list (2-4 bullets)',
      '5) "## Operator Notes" section that preserves provided notes verbatim.',
      'Avoid fluff, lore, or long prose.',
      '',
      `Operator notes to include:\n${operatorNotes || '- Add operator priorities here.'}`,
    ].join('\n');

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.4,
        max_tokens: 380,
        messages: [
          {
            role: 'system',
            content: 'You produce high-signal SOUL.md files for autonomous agents.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json({
        success: true,
        soul_md: fallbackSoul,
        model: 'fallback-local',
        fallback_used: true,
        warning: `OpenRouter request failed (${response.status}).`,
        details,
      });
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return NextResponse.json({
        success: true,
        soul_md: fallbackSoul,
        model: 'fallback-local',
        fallback_used: true,
        warning: 'Model returned empty content.',
      });
    }

    const soulMd = ensureSoulShape(content, agentName, operatorNotes);

    return NextResponse.json({
      success: true,
      soul_md: soulMd,
      model: DEFAULT_MODEL,
      fallback_used: false,
    });
  } catch (error) {
    return NextResponse.json({
      success: true,
      soul_md: generateSoulMarkdown('Unnamed Agent', 'custom', ''),
      model: 'fallback-local',
      fallback_used: true,
      warning: 'Generation failed unexpectedly, used fallback template.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
