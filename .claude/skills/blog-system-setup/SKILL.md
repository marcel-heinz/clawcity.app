---
name: blog-system-setup
description: Set up a lightweight, file-based blog system in existing apps with markdown content, layout categories, SEO metadata, sitemap integration, llms.txt integration, and nav linking. Use when adding a blog to another project and preserving existing app architecture with minimal-merge-risk changes.
---

# Blog System Setup Agent

Implement a reusable blog system for product sites in the same style as ClawCity:

- Markdown posts + frontmatter
- Type-safe content loader
- `/blog` index + `/blog/[slug]` detail pages
- Category/layout-aware rendering
- SEO + schema metadata
- Sitemap + `llms.txt` + `llms-full.txt` integration
- Minimal-risk navbar/footer integration

---

## Quick Start

Execute phases in order:

1. Audit current routes, nav, and SEO surfaces
2. Create content model and folder structure
3. Build blog routes + components
4. Integrate SEO + LLM discovery files
5. Add seed post(s)
6. Validate build and changed routes

---

## Phase 1: Audit First

Read before editing:

- App layout and metadata root
- Navbar and mobile nav implementation
- Footer links
- `sitemap` and `robots` route files
- Existing `llms.txt` and `llms-full.txt` routes (if present)

Map where public pages are currently indexed and where to add `/blog` links.

### Merge-Safety Rules

- Prefer additive edits over refactors.
- Do not reorder existing hook logic in shared components unless required.
- Add nav items with smallest diff possible.
- Keep existing route and metadata conventions intact.

---

## Phase 2: Content Model

Create a file-based model.

Recommended structure:

```text
content/blog/*.md
src/content/blog-data.ts
```

Recommended frontmatter:

```yaml
---
slug: unique-kebab-slug
title: "Post title"
excerpt: "One-paragraph summary"
date: "YYYY-MM-DD"
lastVerified: "YYYY-MM-DD"
readingTime: "6 min"
tags:
  - Tag A
  - Tag B
layout: one-of-layout-types
published: true
coverImage: /optional-image.png
---
```

Required loader capabilities:

- Parse markdown frontmatter
- Validate or normalize `layout`
- Date-gate with `published` + `date <= today`
- Get by slug
- List published posts
- Return related posts

---

## Phase 3: Routes and Rendering

Create:

- `src/app/blog/page.tsx`
- `src/app/blog/[slug]/page.tsx`
- Blog UI components under `src/components/blog/`

Minimum detail page features:

- `generateStaticParams`
- `generateMetadata`
- JSON-LD `BlogPosting`
- Canonical URL
- Related-post links

Recommended layout types (customize per project):

- `engineering-on-clawcity`
- `gameplay`
- `agentic-gameplay`
- `other`

Render layout-specific helper blocks so categories feel distinct.

---

## Phase 4: SEO and LLM Integration

Update:

- `sitemap` to include `/blog` and `/blog/[slug]`
- `llms.txt` to include recent blog posts
- `llms-full.txt` to include an expanded blog index

Ensure:

- Plain-text response headers for llms files
- Revalidation intervals are consistent with project defaults
- All URLs use absolute production domain in llms files

---

## Phase 5: Navigation Integration

Add blog link to:

- Desktop nav
- Mobile nav
- Footer (recommended)

Keep behavior and auth menus unchanged.

---

## Phase 6: Seed Post and Validation

Add at least one published post to verify route generation.

Run:

```bash
npm run build
```

Confirm build output includes:

- `/blog`
- `/blog/[slug]`
- seeded post paths under SSG output

If full lint has known unrelated failures, run targeted lint for changed files and report scope clearly.

---

## Copy/Paste Snippets

### Add recent blogs to llms.txt block

```ts
const recentBlogPosts = getPublishedPosts().slice(0, 8);
const blogBlock = recentBlogPosts.length
  ? [
      '',
      '## Recent Blog Articles',
      ...recentBlogPosts.map((post) =>
        `- [${post.title}](${baseUrl}/blog/${post.slug}): ${post.excerpt}`
      ),
    ].join('\n')
  : '';
```

### Add blog entries to sitemap

```ts
const blogPosts = getPublishedPosts().map((post) => ({
  url: `${baseUrl}/blog/${post.slug}`,
  lastModified: new Date(post.lastVerified ?? post.date),
  changeFrequency: 'weekly' as const,
  priority: 0.75,
}));
```

---

## Done Criteria

- Blog system is fully route-accessible
- At least one published post appears online
- `/blog` and post URLs appear in sitemap
- `llms.txt` and `llms-full.txt` include blog content
- Nav includes blog entry (desktop + mobile)
- Build succeeds
