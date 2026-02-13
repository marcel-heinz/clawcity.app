import { NextRequest, NextResponse } from 'next/server';
import { isAdminConfigured, verifyAdminSession } from '@/lib/admin-auth';
import {
  checkGatewayHealth,
  getGatewayModelSettings,
  isOpenClawConfigured,
  OpenRouterGatewayModel,
  updateGatewayModelSettings,
} from '@/lib/openclaw';

const ALLOWED_MODELS: OpenRouterGatewayModel[] = [
  'z-ai/glm-5',
  'minimax/minimax-m2.5',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForModelActivation(
  targetModel: OpenRouterGatewayModel,
  attempts = 6,
  delayMs = 300
): Promise<{
  activeModel: OpenRouterGatewayModel | null;
  isActive: boolean;
}> {
  for (let i = 0; i < attempts; i++) {
    const current = await getGatewayModelSettings();
    if (current.success && current.model) {
      if (current.model === targetModel) {
        return { activeModel: current.model, isActive: true };
      }
      if (i === attempts - 1) {
        return { activeModel: current.model, isActive: false };
      }
    }
    await sleep(delayMs);
  }

  return { activeModel: null, isActive: false };
}

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

  const health = await checkGatewayHealth();
  const resolvedModel = result.model || ALLOWED_MODELS[0];

  return NextResponse.json({
    success: true,
    data: {
      model: resolvedModel,
      models:
        result.models && result.models.length > 0
          ? result.models
          : ALLOWED_MODELS,
      status: {
        gateway_healthy: health.healthy,
        active_model: resolvedModel,
        is_active: health.healthy,
        checked_at: new Date().toISOString(),
      },
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

  const targetModel = rawModel as OpenRouterGatewayModel;
  const result = await updateGatewayModelSettings(targetModel);
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error || 'Failed to update gateway model settings' },
      { status: result.status && result.status >= 400 ? result.status : 502 }
    );
  }

  const activation = await waitForModelActivation(targetModel);
  const health = await checkGatewayHealth();

  return NextResponse.json({
    success: true,
    data: {
      model: result.model || targetModel,
      models:
        result.models && result.models.length > 0
          ? result.models
          : ALLOWED_MODELS,
      status: {
        gateway_healthy: health.healthy,
        active_model: activation.activeModel,
        is_active: activation.isActive && health.healthy,
        checked_at: new Date().toISOString(),
      },
    },
  });
}
