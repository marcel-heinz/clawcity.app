import { NextRequest, NextResponse } from 'next/server';

function getTokenFromHeader(value: string | null): string {
  if (!value) return '';
  if (!value.toLowerCase().startsWith('bearer ')) return '';
  return value.slice(7).trim();
}

export function assertInternalApiAuth(request: NextRequest): NextResponse | null {
  const expected = process.env.OPENCLAW_INTERNAL_API_TOKEN || process.env.OPENCLAW_PROVISION_TOKEN || '';
  if (!expected) {
    return NextResponse.json({ error: 'Internal API token not configured' }, { status: 503 });
  }

  const provided = getTokenFromHeader(request.headers.get('authorization'));
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
