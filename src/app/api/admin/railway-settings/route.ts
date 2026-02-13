import { NextRequest, NextResponse } from 'next/server';
import { isAdminConfigured, verifyAdminSession } from '@/lib/admin-auth';
import {
  getGatewayModelSettings,
  isOpenClawConfigured,
  OpenRouterGatewayModel,
  updateGatewayModelSettings,
} from '@/lib/openclaw';

const ALLOWED_MODELS: OpenRouterGatewayModel[] = [
  'z-ai/glm-5',
  'minimax/minimax-m2.5',
];

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Admin dashboard not configured' },
      { status: 503 }
    );
  }

  if (!verifyAdminSession(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  if (!isOpenClawConfigured()) {
    return NextResponse.json(
      { success: false, error: 'OpenClaw gateway is not configured' },
      { status: 503 }
    );
  }

  const result = await getGatewayModelSettings();
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error || 'Failed to fetch gateway model settings' },
      { status: result.status && result.status >= 400 ? result.status : 502 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      model: result.model || ALLOWED_MODELS[0],
      models:
        result.models && result.models.length > 0
          ? result.models
          : ALLOWED_MODELS,
    },
  });
}

export async function PUT(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Admin dashboard not configured' },
      { status: 503 }
    );
  }

  if (!verifyAdminSession(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  if (!isOpenClawConfigured()) {
    return NextResponse.json(
      { success: false, error: 'OpenClaw gateway is not configured' },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const rawModel = typeof body?.model === 'string' ? body.model.trim() : '';
  if (!ALLOWED_MODELS.includes(rawModel as OpenRouterGatewayModel)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid model. Allowed values: z-ai/glm-5, minimax/minimax-m2.5',
      },
      { status: 400 }
    );
  }

  const result = await updateGatewayModelSettings(rawModel as OpenRouterGatewayModel);
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error || 'Failed to update gateway model settings' },
      { status: result.status && result.status >= 400 ? result.status : 502 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      model: result.model || rawModel,
      models:
        result.models && result.models.length > 0
          ? result.models
          : ALLOWED_MODELS,
    },
  });
}
