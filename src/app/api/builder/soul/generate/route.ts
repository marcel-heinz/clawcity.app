import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import { generateSoulMarkdown } from '@/lib/agent-soul';

const DEFAULT_MODEL = process.env.OPENROUTER_SOUL_MODEL || 'z-ai/glm-5';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
type WarningCode =
  | 'configuration'
  | 'http_error'
  | 'provider_refusal'
  | 'provider_error'
  | 'empty_content'
  | 'unexpected_error';
type ContentShape = 'string' | 'array' | 'null' | 'other';

type OpenRouterContentPart = {
  type?: string;
  text?: string;
};

type OpenRouterChoice = {
  finish_reason?: string | null;
  message?: {
    content?: string | OpenRouterContentPart[] | null;
    refusal?: string | null;
  };
  error?: {
    message?: string;
  } | string | null;
};

function extractMessageText(
  content: string | OpenRouterContentPart[] | null | undefined
): { text: string; shape: ContentShape } {
  if (typeof content === 'string') {
    return { text: content.trim(), shape: 'string' };
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        if (part.type && part.type !== 'text') return '';
        return typeof part.text === 'string' ? part.text : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    return { text, shape: 'array' };
  }

  if (content == null) {
    return { text: '', shape: 'null' };
  }

  return { text: '', shape: 'other' };
}

function fallbackResponse(
  soulMd: string,
  warning: string,
  warningCode: WarningCode,
  extras?: {
    details?: string;
    contentShape?: ContentShape;
  }
) {
  return NextResponse.json({
    success: true,
    soul_md: soulMd,
    model: 'fallback-local',
    fallback_used: true,
    warning,
    warning_code: warningCode,
    content_shape: extras?.contentShape,
    details: extras?.details,
  });
}

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
      return fallbackResponse(
        fallbackSoul,
        'OPENROUTER_API_KEY is not configured, used fallback template.',
        'configuration'
      );
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
      console.warn('[builder:soul-generate] OpenRouter request failed', {
        model: DEFAULT_MODEL,
        status: response.status,
      });
      return fallbackResponse(
        fallbackSoul,
        `OpenRouter request failed (${response.status}).`,
        'http_error',
        { details }
      );
    }

    const data = await response.json() as {
      choices?: OpenRouterChoice[];
    };
    const choice = data.choices?.[0];
    const { text: content, shape: contentShape } = extractMessageText(choice?.message?.content);
    const refusal = choice?.message?.refusal?.trim();
    const finishReason = choice?.finish_reason ?? null;
    const choiceError = typeof choice?.error === 'string'
      ? choice.error
      : choice?.error?.message;

    console.info('[builder:soul-generate] OpenRouter completion', {
      model: DEFAULT_MODEL,
      finish_reason: finishReason,
      has_refusal: Boolean(refusal),
      content_shape: contentShape,
    });

    if (!content) {
      const warningCode: WarningCode = refusal
        ? 'provider_refusal'
        : choiceError
          ? 'provider_error'
          : 'empty_content';
      const warning = refusal
        ? `Model refused this request: ${refusal}`
        : choiceError
          ? `Model returned an error: ${choiceError}`
          : 'Model returned empty content.';

      console.warn('[builder:soul-generate] Empty model content, using fallback', {
        model: DEFAULT_MODEL,
        finish_reason: finishReason,
        has_refusal: Boolean(refusal),
        content_shape: contentShape,
        warning_code: warningCode,
      });

      return fallbackResponse(fallbackSoul, warning, warningCode, { contentShape });
    }

    const soulMd = ensureSoulShape(content, agentName, operatorNotes);

    return NextResponse.json({
      success: true,
      soul_md: soulMd,
      model: DEFAULT_MODEL,
      fallback_used: false,
      content_shape: contentShape,
    });
  } catch (error) {
    return fallbackResponse(
      generateSoulMarkdown('Unnamed Agent', 'custom', ''),
      'Generation failed unexpectedly, used fallback template.',
      'unexpected_error',
      { details: error instanceof Error ? error.message : String(error) }
    );
  }
}
