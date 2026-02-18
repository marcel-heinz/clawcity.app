# Blog System Setup Playbook

This document describes the reusable blog system pattern used for ClawCity and packaged in:

- `.claude/skills/blog-system-setup/SKILL.md`

Use it when adding a blog to another project with SEO + LLM discoverability in mind.

## Goals

- Keep the system simple (file-based markdown)
- Publish fast with low infrastructure overhead
- Support clear content categories/layouts
- Make posts indexable for search engines and LLMs
- Avoid risky refactors that create merge conflicts

## Recommended Architecture

```text
content/blog/*.md
src/content/blog-data.ts
src/components/blog/*
src/app/blog/page.tsx
src/app/blog/[slug]/page.tsx
```

## Frontmatter Contract

Each post should include:

```yaml
---
slug: unique-kebab-slug
title: "Post title"
excerpt: "Summary"
date: "YYYY-MM-DD"
lastVerified: "YYYY-MM-DD"
readingTime: "6 min"
tags:
  - Tag A
  - Tag B
layout: engineering-on-clawcity | gameplay | agentic-gameplay | other
published: true
coverImage: /optional-image.png
---
```

## Rendering Contract

### `/blog`

- Group posts by `layout`
- Show date, reading time, tags, excerpt
- Keep cards scannable

### `/blog/[slug]`

- `generateStaticParams`
- `generateMetadata`
- JSON-LD `BlogPosting`
- related posts section
- canonical URL

## SEO + LLM Integration

### `sitemap`

Add:

- `/blog`
- all `/blog/[slug]`

### `llms.txt`

Add a compact recent-post section (for quick LLM retrieval):

- title
- URL
- short excerpt

### `llms-full.txt`

Add a larger blog knowledge section with more posts and layout labels.

## Navigation Integration (Merge-Safe)

Add `Blog` link to:

- desktop nav
- mobile nav
- footer

Rules:

- prefer additive edits
- avoid unrelated nav refactors
- preserve existing auth/menu behavior

## Validation Checklist

1. Build succeeds (`npm run build`)
2. `/blog` appears in route output
3. post detail paths appear in SSG output
4. sitemap includes blog routes
5. llms routes include blog entries

## Content Quality Baseline

To avoid thin pages:

- prioritize fewer, stronger posts
- include concrete examples and operational details
- add explicit source/verification dates for evolving topics
- target 5–7 minute read for standard playbook posts

## One-Post Smoke Test

For first deployment, publish one post only and verify:

- it appears first in `/blog`
- detail page resolves
- metadata and JSON-LD render
- sitemap and llms files include it

Then scale content cadence.
