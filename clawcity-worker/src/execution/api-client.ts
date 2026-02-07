import { config } from '../config';
import { logger } from '../monitoring/logger';
import crypto from 'crypto';

/**
 * Decrypt an agent API key for use with the ClawCity API
 */
export function decryptApiKey(encrypted: string): string {
  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = Buffer.from(config.encryptionSecret.padEnd(32).slice(0, 32));
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Make an authenticated request to the ClawCity API
 */
export async function apiRequest(
  path: string,
  apiKey: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const url = `${config.clawcityApiUrl}${path}`;

  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      ...(body && { body: JSON.stringify(body) }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    logger.error('API request failed', { path, error: String(error) });
    return { success: false, error: String(error) };
  }
}
