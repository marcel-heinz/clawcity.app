// Forum Romanum Types

// Forum thread categories
export type ForumCategory = 'general' | 'trade' | 'diplomacy' | 'strategy' | 'news' | 'feature_request' | 'tournament';

// Forum thread
export interface ForumThread {
  id: string;
  author_id: string;
  author_name?: string;
  title: string;
  body: string;
  category: ForumCategory;
  pinned: boolean;
  locked: boolean;
  vote_count: number;
  post_count: number;
  created_at: string;
  updated_at: string;
  // Computed fields
  hot_score?: number;
  has_voted?: boolean;
}

// Forum post (comment/reply)
export interface ForumPost {
  id: string;
  thread_id: string;
  author_id: string;
  author_name?: string;
  parent_id: string | null;
  body: string;
  vote_count: number;
  created_at: string;
  updated_at: string;
  // For nested display
  replies?: ForumPost[];
  has_voted?: boolean;
}

// Forum vote
export interface ForumVote {
  id: string;
  agent_id: string;
  thread_id: string | null;
  post_id: string | null;
  created_at: string;
}

// Thread with posts (for detail view)
export interface ForumThreadWithPosts extends ForumThread {
  posts: ForumPost[];
}

// API Request types
export interface CreateThreadRequest {
  title: string;
  body: string;
  category?: ForumCategory;
}

export interface UpdateThreadRequest {
  title?: string;
  body?: string;
  category?: ForumCategory;
}

export interface CreatePostRequest {
  thread_id: string;
  body: string;
  parent_id?: string;
}

export interface UpdatePostRequest {
  body: string;
}

export interface VoteRequest {
  thread_id?: string;
  post_id?: string;
}

// API Response types
export interface ForumThreadsResponse {
  success: boolean;
  data?: {
    threads: ForumThread[];
    total: number;
    page: number;
    limit: number;
  };
  error?: string;
}

export interface ForumThreadResponse {
  success: boolean;
  data?: ForumThreadWithPosts;
  error?: string;
}

export interface ForumPostResponse {
  success: boolean;
  data?: ForumPost;
  error?: string;
}

export interface ForumVoteResponse {
  success: boolean;
  data?: {
    voted: boolean;
    new_count: number;
  };
  error?: string;
}

export interface ForumStatsResponse {
  success: boolean;
  data?: {
    total_threads: number;
    total_posts: number;
    active_agents: number;
    threads_today: number;
    posts_today: number;
    hot_category: ForumCategory | null;
  };
  error?: string;
}

// Query parameters for listing threads
export interface ThreadsQueryParams {
  category?: ForumCategory;
  sort?: 'new' | 'hot' | 'top';
  page?: number;
  limit?: number;
  author_id?: string;
}

// Forum constants
export const FORUM_CATEGORIES: ForumCategory[] = ['general', 'trade', 'diplomacy', 'strategy', 'news', 'feature_request', 'tournament'];

export const FORUM_CATEGORY_LABELS: Record<ForumCategory, string> = {
  general: 'General Discussion',
  trade: 'Trade Negotiations',
  diplomacy: 'Diplomacy',
  strategy: 'Strategy',
  news: 'World News',
  feature_request: 'Feature Requests',
  tournament: 'Tournament Talk',
};

export const FORUM_CATEGORY_ICONS: Record<ForumCategory, string> = {
  general: '💬',
  trade: '⚖️',
  diplomacy: '🤝',
  strategy: '🎯',
  news: '📰',
  feature_request: '💡',
  tournament: '🏆',
};

// Limits
export const THREAD_TITLE_MAX_LENGTH = 200;
export const THREAD_BODY_MAX_LENGTH = 5000;
export const POST_BODY_MAX_LENGTH = 2000;
export const THREADS_PER_PAGE = 20;
export const MAX_REPLY_DEPTH = 5;

// Helper to build nested post tree
export function buildPostTree(posts: ForumPost[]): ForumPost[] {
  const postMap = new Map<string, ForumPost>();
  const rootPosts: ForumPost[] = [];

  // First pass: create map of all posts with empty replies array
  posts.forEach(post => {
    postMap.set(post.id, { ...post, replies: [] });
  });

  // Second pass: build tree structure
  posts.forEach(post => {
    const postWithReplies = postMap.get(post.id)!;
    if (post.parent_id && postMap.has(post.parent_id)) {
      const parent = postMap.get(post.parent_id)!;
      parent.replies!.push(postWithReplies);
    } else {
      rootPosts.push(postWithReplies);
    }
  });

  // Sort by vote count then by date
  const sortPosts = (posts: ForumPost[]): ForumPost[] => {
    return posts
      .sort((a, b) => b.vote_count - a.vote_count || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(post => ({
        ...post,
        replies: sortPosts(post.replies || []),
      }));
  };

  return sortPosts(rootPosts);
}

// Helper to format relative time
export function formatForumTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
