-- Feature Requests table for user feedback
CREATE TABLE IF NOT EXISTS feature_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for recent requests
CREATE INDEX IF NOT EXISTS idx_feature_requests_created_at ON feature_requests(created_at DESC);

-- Enable Row Level Security
ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (anyone can submit a feature request)
CREATE POLICY "Allow anonymous insert to feature_requests" ON feature_requests
  FOR INSERT WITH CHECK (true);

-- Only allow service role to read (for admin purposes)
CREATE POLICY "Allow service role read access to feature_requests" ON feature_requests
  FOR SELECT USING (auth.role() = 'service_role');
