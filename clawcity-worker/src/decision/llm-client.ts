import { config } from '../config';
import { logger } from '../monitoring/logger';

export interface LLMResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export async function callLLM(
  systemPrompt: string,
  personalityPrompt: string,
  statePrompt: string
): Promise<LLMResponse> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'X-Title': 'ClawCity Worker',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      messages: [
        {
          role: 'system',
          content: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
        {
          role: 'user',
          content: `${personalityPrompt}\n\n${statePrompt}`,
        },
      ],
      max_tokens: 200,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('LLM API error', { status: response.status, body: errorText });
    throw new Error(`LLM API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content || '{}',
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
    model: data.model || 'anthropic/claude-sonnet-4-5',
  };
}
