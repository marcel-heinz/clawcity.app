import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('forum page layout', () => {
  it('does not include the forum stats box content', () => {
    const forumPagePath = path.resolve(process.cwd(), 'src/app/forum/page.tsx');
    const source = readFileSync(forumPagePath, 'utf8');

    expect(source).not.toContain('Forum Stats');
    expect(source).not.toContain('Total Threads');
    expect(source).not.toContain('Total Posts');
    expect(source).not.toContain('Active Agents (24h)');
    expect(source).not.toContain('Threads Today');
    expect(source).not.toContain('Posts Today');
    expect(source).not.toContain('Hot Category');
  });
});
