import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export const BLOG_LAYOUTS = [
  'engineering-on-clawcity',
  'gameplay',
  'agentic-gameplay',
  'other',
] as const;

export type BlogLayout = (typeof BLOG_LAYOUTS)[number];

export const BLOG_LAYOUT_LABELS: Record<BlogLayout, { label: string; description: string }> = {
  'engineering-on-clawcity': {
    label: 'Engineering on ClawCity',
    description: 'System design, migrations, performance, and technical decisions.',
  },
  gameplay: {
    label: 'Gameplay',
    description: 'Human-facing strategy, tournament prep, and economy playbooks.',
  },
  'agentic-gameplay': {
    label: 'Agentic Gameplay',
    description: 'Decision loops, automation patterns, and autonomous agent tactics.',
  },
  other: {
    label: 'Other',
    description: 'Announcements, ecosystem updates, and broad editorial content.',
  },
};

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readingTime: string;
  tags: string[];
  published: boolean;
  layout: BlogLayout;
  coverImage?: string;
  lastVerified?: string;
  content: string;
}

const BLOG_DIRECTORY = path.join(process.cwd(), 'content', 'blog');

function toIsoDate(input: unknown): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return new Date().toISOString().split('T')[0];
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().split('T')[0];
  }

  return parsed.toISOString().split('T')[0];
}

function toStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function toReadingTime(content: string, explicit: unknown): string {
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit;
  }

  const words = content.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(3, Math.ceil(words / 220));
  return `${minutes} min`;
}

function toLayout(input: unknown): BlogLayout {
  if (typeof input === 'string' && BLOG_LAYOUTS.includes(input as BlogLayout)) {
    return input as BlogLayout;
  }
  return 'other';
}

function readPostFile(filename: string): BlogPost {
  const filePath = path.join(BLOG_DIRECTORY, filename);
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContent);

  const slug =
    typeof data.slug === 'string' && data.slug.trim().length > 0
      ? data.slug
      : filename.replace(/\.md$/, '');

  return {
    slug,
    title: typeof data.title === 'string' && data.title.trim().length > 0 ? data.title : 'Untitled',
    excerpt: typeof data.excerpt === 'string' ? data.excerpt : '',
    date: toIsoDate(data.date),
    readingTime: toReadingTime(content, data.readingTime),
    tags: toStringList(data.tags),
    published: data.published === true,
    layout: toLayout(data.layout),
    coverImage: typeof data.coverImage === 'string' ? data.coverImage : undefined,
    lastVerified:
      typeof data.lastVerified === 'string' && data.lastVerified.trim().length > 0
        ? toIsoDate(data.lastVerified)
        : undefined,
    content,
  };
}

export function getBlogPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIRECTORY)) {
    return [];
  }

  return fs
    .readdirSync(BLOG_DIRECTORY)
    .filter((filename) => filename.endsWith('.md'))
    .map((filename) => readPostFile(filename))
    .sort((a, b) => {
      const dateSort = new Date(b.date).getTime() - new Date(a.date).getTime();
      return dateSort !== 0 ? dateSort : a.title.localeCompare(b.title);
    });
}

export function getPublishedPosts(): BlogPost[] {
  const today = new Date().toISOString().split('T')[0];
  return getBlogPosts().filter((post) => post.published && post.date <= today);
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return getBlogPosts().find((post) => post.slug === slug);
}

export function getPublishedPostsByLayout(layout: BlogLayout): BlogPost[] {
  return getPublishedPosts().filter((post) => post.layout === layout);
}

export function getRelatedPosts(post: BlogPost, limit = 3): BlogPost[] {
  return getPublishedPosts()
    .filter((candidate) => candidate.slug !== post.slug)
    .map((candidate) => {
      const sharedTags = candidate.tags.filter((tag) => post.tags.includes(tag)).length;
      const sameLayoutScore = candidate.layout === post.layout ? 2 : 0;
      return { candidate, score: sharedTags + sameLayoutScore };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.candidate)
    .slice(0, limit);
}
