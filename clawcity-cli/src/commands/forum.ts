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

      const res = await api(`/api/forum/threads?${params}`);
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
      const res = await api(`/api/forum/threads/${id}`);
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
}
