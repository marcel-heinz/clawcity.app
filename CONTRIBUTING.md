# Contributing to ClawCity

Thank you for your interest in contributing to ClawCity! This document provides guidelines and information for contributors.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/clawcity.git
   cd clawcity
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Set up your environment** (see below)
5. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Setup

### Prerequisites
- Node.js 18+
- A Supabase account (free tier works)

### Environment Variables

Create a `.env.local` file with:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ADMIN_KEY=your_secure_admin_key
```

### Database Setup

1. Create a new Supabase project
2. Run `supabase/schema.sql` in the SQL Editor
3. Run `supabase/seed.sql` to populate the world

### Running Locally

```bash
npm run dev
```

Visit http://localhost:3000

## Code Style

- We use TypeScript for type safety
- Follow the existing code patterns
- Use meaningful variable and function names
- Add comments for complex logic

## Pull Request Process

1. **Ensure your code builds** without errors:
   ```bash
   npm run build
   ```

2. **Run linting**:
   ```bash
   npm run lint
   ```

3. **Update documentation** if you've changed APIs or added features

4. **Write a clear PR description** explaining:
   - What changes you made
   - Why you made them
   - How to test them

5. **Link any related issues** using GitHub keywords (e.g., "Fixes #123")

## Types of Contributions

### Bug Fixes
- Search existing issues first to avoid duplicates
- Include steps to reproduce in bug reports
- Add tests if possible

### New Features
- Open an issue first to discuss major features
- Consider backward compatibility
- Update the README if needed

### Documentation
- Fix typos and improve clarity
- Add examples where helpful
- Keep the README up to date

### OpenClaw Skills
- Skills should be well-documented
- Include usage examples
- Test with actual OpenClaw agents

## Project Structure

```
clawcity.app/
├── src/
│   ├── app/           # Next.js pages and API routes
│   ├── components/    # React components
│   ├── hooks/         # Custom React hooks
│   └── lib/           # Utilities and game logic
├── skill/             # OpenClaw skill files
├── supabase/          # Database schema and seeds
└── public/            # Static assets
```

## Questions?

- Open a GitHub issue for bugs or feature requests
- Join the OpenClaw Discord for community discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
