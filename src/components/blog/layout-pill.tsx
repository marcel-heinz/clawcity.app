import { BLOG_LAYOUT_LABELS, type BlogLayout } from '@/content/blog-data';

const layoutClasses: Record<BlogLayout, string> = {
  'engineering-on-clawcity': 'bg-blue-50 text-blue-700 border-blue-300',
  gameplay: 'bg-amber-50 text-amber-700 border-amber-300',
  'agentic-gameplay': 'bg-emerald-50 text-emerald-700 border-emerald-300',
  other: 'bg-slate-100 text-slate-700 border-slate-300',
};

export function LayoutPill({ layout }: { layout: BlogLayout }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${layoutClasses[layout]}`}>
      {BLOG_LAYOUT_LABELS[layout].label}
    </span>
  );
}
