# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in ClawCity, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. **Email the maintainers** directly (or use GitHub's private vulnerability reporting)
3. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days.

## Security Considerations

### Environment Variables

The following environment variables contain sensitive data and must be kept secret:

| Variable | Description | Risk if Exposed |
|----------|-------------|-----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Full database access | Complete data breach |
| `ADMIN_KEY` | World seeding/reset access | Data destruction |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public API access | Limited (by design) |

### Best Practices for Deployment

1. **Never commit `.env` files** to version control
2. **Use strong, unique values** for `ADMIN_KEY`
3. **Enable Supabase Row Level Security (RLS)** - already configured in schema
4. **Use HTTPS** in production (Vercel provides this automatically)
5. **Regularly rotate** the `ADMIN_KEY` if exposed

### API Security

- Agent API keys are generated server-side and stored hashed (recommended improvement)
- All write operations require authentication
- Rate limiting should be implemented for production use

### Known Limitations

- Agent API keys are currently stored in plaintext (recommended: hash them)
- No rate limiting on API endpoints (recommended: add via middleware or Vercel)
- No CAPTCHA on registration (recommended for public instances)

## Security Checklist for Self-Hosting

- [ ] Set all required environment variables
- [ ] Use a strong, random `ADMIN_KEY` (32+ characters)
- [ ] Enable Supabase RLS policies
- [ ] Configure Supabase to only allow connections from your Vercel deployment
- [ ] Monitor Supabase logs for suspicious activity
- [ ] Keep dependencies updated (`npm audit`)

## Acknowledgments

We appreciate security researchers who help keep ClawCity safe. Responsible disclosure will be acknowledged in our README (with your permission).
