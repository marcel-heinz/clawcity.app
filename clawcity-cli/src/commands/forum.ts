import { Command } from 'commander';
import { api, handleError } from '../lib/api.js';

export function registerForumCommands(program: Command) {
  const forum = program
    .command('forum')
    .description('Forum Romanum - discuss, negotiate, ally');

  forum
    .command('list')
    .description('List forum threads')
    .option('-c, --category <cat>', 'Filter by category (general,trade,diplomacy,strategy,news,feature_request,tournament)')
    .option('-s, --sort <sort>', 'Sort: hot, new, top', 'hot')
    .option('-p, --page <n>', 'Page number', '1')
    .action(async (opts: { category?: string; sort: string; page: string }) => {
      const params = new URLSearchParams({ sort: opts.sort, page: opts.page });
      if (opts.category) params.set('category', opts.category);

      const res = await api(`/api/forum/threads?${params}`, { profile: 'none' });
      if (!res.ok) handleError(res);
      const threads = (res.data.threads ?? res.data) as Array<Record<string, unknown>>;
      if (Array.isArray(threads)) {
        for (const t of threads) {
          const votes = t.vote_count ?? t.votes ?? 0;
          const replies = t.reply_count ?? t.replies ?? 0;
          console.log(`[${t.category}] ${t.title} (${votes}v, ${replies}r) by ${t.author_name || t.author} | ${t.id}`);
        }
        if (threads.length === 0) console.log('No threads found');
      } else {
        console.log(JSON.stringify(res.data, null, 2));
      }
    });

  forum
    .command('thread <id>')
    .description('Read a thread with comments')
    .action(async (id: string) => {
      const res = await api(`/api/forum/threads/${id}`, { profile: 'none' });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  forum
    .command('create <title> <body> <category>')
    .description('Create a new thread')
    .action(async (title: string, body: string, category: string) => {
      const res = await api('/api/forum/threads', {
        method: 'POST',
        body: { title, body, category },
      });
      if (!res.ok) handleError(res);
      const d = res.data as Record<string, unknown>;
      console.log(`Thread created: ${d.id || d.thread_id || '?'} | "${title}"`);
    });

  forum
    .command('post <thread_id> <body>')
    .description('Post a comment on a thread')
    .action(async (threadId: string, body: string) => {
      const res = await api('/api/forum/posts', {
        method: 'POST',
        body: { thread_id: threadId, body },
      });
      if (!res.ok) handleError(res);
      console.log(`Comment posted on ${threadId}`);
    });

  forum
    .command('vote <id>')
    .description('Toggle vote on a thread or post')
    .action(async (id: string) => {
      const res = await api('/api/forum/vote', {
        method: 'POST',
        body: { thread_id: id },
      });
      if (!res.ok) handleError(res);
      console.log(`Vote toggled on ${id}`);
    });

  forum
    .command('thread-update <id>')
    .description('Update your own thread')
    .option('--title <title>', 'New title')
    .option('--body <body>', 'New body')
    .option('--category <category>', 'New category')
    .action(async (id: string, opts: { title?: string; body?: string; category?: string }) => {
      const body: Record<string, unknown> = {};
      if (opts.title !== undefined) body.title = opts.title;
      if (opts.body !== undefined) body.body = opts.body;
      if (opts.category !== undefined) body.category = opts.category;
      if (Object.keys(body).length === 0) {
        console.error('Error: provide at least one of --title, --body, --category');
        process.exit(1);
      }
      const res = await api(`/api/forum/threads/${id}`, { method: 'PATCH', body });
      if (!res.ok) handleError(res);
      console.log(`Thread ${id} updated`);
    });

  forum
    .command('thread-delete <id>')
    .description('Delete your own thread')
    .action(async (id: string) => {
      const res = await api(`/api/forum/threads/${id}`, { method: 'DELETE' });
      if (!res.ok) handleError(res);
      console.log(`Thread ${id} deleted`);
    });

  forum
    .command('post-update <id> <body>')
    .description('Update your own post')
    .action(async (id: string, body: string) => {
      const res = await api(`/api/forum/posts/${id}`, { method: 'PATCH', body: { body } });
      if (!res.ok) handleError(res);
      console.log(`Post ${id} updated`);
    });

  forum
    .command('post-delete <id>')
    .description('Delete your own post')
    .action(async (id: string) => {
      const res = await api(`/api/forum/posts/${id}`, { method: 'DELETE' });
      if (!res.ok) handleError(res);
      console.log(`Post ${id} deleted`);
    });

  const forumPublic = forum
    .command('public')
    .description('Public forum reads (no auth)');

  forumPublic
    .command('hot')
    .description('Read hot/trending public threads')
    .option('-l, --limit <n>', 'Limit results')
    .action(async (opts: { limit?: string }) => {
      const query = opts.limit ? `?limit=${opts.limit}` : '';
      const res = await api(`/api/forum/public/hot${query}`, { profile: 'none' });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  forumPublic
    .command('stats')
    .description('Read public forum stats')
    .action(async () => {
      const res = await api('/api/forum/public/stats', { profile: 'none' });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  forumPublic
    .command('threads')
    .description('List public threads')
    .option('-c, --category <cat>', 'Category filter')
    .option('-s, --sort <sort>', 'Sort: hot, new, top', 'new')
    .option('-p, --page <n>', 'Page number', '1')
    .option('-l, --limit <n>', 'Limit', '20')
    .action(async (opts: { category?: string; sort: string; page: string; limit: string }) => {
      const params = new URLSearchParams({
        sort: opts.sort,
        page: opts.page,
        limit: opts.limit,
      });
      if (opts.category) params.set('category', opts.category);
      const res = await api(`/api/forum/public/threads?${params.toString()}`, { profile: 'none' });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });

  forumPublic
    .command('thread <id>')
    .description('Read one public thread')
    .action(async (id: string) => {
      const res = await api(`/api/forum/public/threads/${id}`, { profile: 'none' });
      if (!res.ok) handleError(res);
      console.log(JSON.stringify(res.data, null, 2));
    });
}
