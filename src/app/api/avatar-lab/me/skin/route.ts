import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateAvatarLabSession,
  clearAvatarLabSessionCookie,
  generateAvatarLabSecret,
} from '@/lib/avatar-lab-operator-auth';
import { createServerClient } from '@/lib/supabase';

const SKIN_BUCKET = 'avatar-skins';
const MAX_SKIN_BYTES = 5 * 1024 * 1024;

const EXTENSIONS_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function unauthorizedWithCookieClear(error: string): NextResponse {
  const response = NextResponse.json({ success: false, error }, { status: 401 });
  clearAvatarLabSessionCookie(response);
  return response;
}

export async function POST(request: NextRequest) {
  const auth = await authenticateAvatarLabSession(request);
  if (!auth.success) {
    if (auth.status === 401) {
      return unauthorizedWithCookieClear(auth.error);
    }
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid multipart form data' }, { status: 400 });
  }

  const uploaded = formData.get('file');
  if (!(uploaded instanceof File)) {
    return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 });
  }

  const mimeType = uploaded.type;
  const extension = EXTENSIONS_BY_MIME[mimeType];
  if (!extension) {
    return NextResponse.json(
      { success: false, error: 'Unsupported image type. Allowed: PNG, JPG, WebP' },
      { status: 400 }
    );
  }

  if (uploaded.size <= 0 || uploaded.size > MAX_SKIN_BYTES) {
    return NextResponse.json(
      { success: false, error: 'Skin image must be between 1 byte and 5MB' },
      { status: 400 }
    );
  }

  try {
    const supabase = createServerClient();
    const bytes = Buffer.from(await uploaded.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    const objectPath = `${auth.session.agentId}/${Date.now()}-${generateAvatarLabSecret(10)}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(SKIN_BUCKET)
      .upload(objectPath, bytes, {
        contentType: mimeType,
        cacheControl: '31536000',
        upsert: false,
      });

    if (uploadError) {
      console.error('Avatar lab skin upload failed:', uploadError);
      return NextResponse.json({ success: false, error: 'Failed to upload skin image' }, { status: 500 });
    }

    const { data: publicData } = supabase.storage.from(SKIN_BUCKET).getPublicUrl(objectPath);
    const publicUrl = publicData.publicUrl;

    const { error: assetError } = await supabase
      .from('agent_avatar_skin_assets')
      .insert({
        agent_id: auth.session.agentId,
        storage_path: objectPath,
        mime_type: mimeType,
        bytes: uploaded.size,
        sha256,
      });

    if (assetError) {
      console.error('Avatar lab skin asset insert failed:', assetError);
      // Keep uploaded object; metadata failure should not block the user's flow.
    }

    return NextResponse.json({
      success: true,
      data: {
        skin_data_url: publicUrl,
        storage_path: objectPath,
        mime_type: mimeType,
        bytes: uploaded.size,
      },
    });
  } catch (error) {
    console.error('Avatar lab me/skin route error:', error);
    return NextResponse.json({ success: false, error: 'Failed to upload skin image' }, { status: 500 });
  }
}
