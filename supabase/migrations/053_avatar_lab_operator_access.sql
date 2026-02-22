-- ============================================================================
-- 053: Operator Avatar Lab Access (CLI-issued links + session + skin assets)
-- ============================================================================

-- One-time links issued by authenticated agents (via CLI/API) for human operators.
CREATE TABLE IF NOT EXISTS public.agent_avatar_lab_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_avatar_lab_links_agent_created
  ON public.agent_avatar_lab_links(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_avatar_lab_links_active
  ON public.agent_avatar_lab_links(agent_id, expires_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- Browser session rows for operator-only avatar lab surface.
CREATE TABLE IF NOT EXISTS public.agent_avatar_lab_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_avatar_lab_sessions_agent_created
  ON public.agent_avatar_lab_sessions(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_avatar_lab_sessions_active
  ON public.agent_avatar_lab_sessions(agent_id, expires_at DESC)
  WHERE revoked_at IS NULL;

-- Track uploaded skin assets for cleanup/audit.
CREATE TABLE IF NOT EXISTS public.agent_avatar_skin_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes INT NOT NULL CHECK (bytes > 0),
  sha256 TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_avatar_skin_assets_agent_created
  ON public.agent_avatar_skin_assets(agent_id, created_at DESC);

-- Lock tables behind service-role-only access.
ALTER TABLE public.agent_avatar_lab_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_avatar_lab_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_avatar_skin_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to agent_avatar_lab_links" ON public.agent_avatar_lab_links;
CREATE POLICY "Service role full access to agent_avatar_lab_links"
  ON public.agent_avatar_lab_links
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to agent_avatar_lab_sessions" ON public.agent_avatar_lab_sessions;
CREATE POLICY "Service role full access to agent_avatar_lab_sessions"
  ON public.agent_avatar_lab_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to agent_avatar_skin_assets" ON public.agent_avatar_skin_assets;
CREATE POLICY "Service role full access to agent_avatar_skin_assets"
  ON public.agent_avatar_skin_assets
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Public bucket for skin textures used in world/search previews.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatar-skins',
  'avatar-skins',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read for avatar skin assets + service-role writes scoped to this bucket.
DROP POLICY IF EXISTS "Avatar skins are publicly readable" ON storage.objects;
CREATE POLICY "Avatar skins are publicly readable"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatar-skins');

DROP POLICY IF EXISTS "Service role manages avatar skins" ON storage.objects;
CREATE POLICY "Service role manages avatar skins"
  ON storage.objects
  FOR ALL
  USING (auth.role() = 'service_role' AND bucket_id = 'avatar-skins')
  WITH CHECK (auth.role() = 'service_role' AND bucket_id = 'avatar-skins');
