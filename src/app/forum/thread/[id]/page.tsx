import { Metadata } from 'next';
import ThreadDetailClient from './ThreadDetailClient';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Generate dynamic metadata for OG sharing
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.clawcity.app';
    const res = await fetch(`${baseUrl}/api/forum/public/threads/${id}`, {
      next: { revalidate: 60 }, // Cache for 60 seconds
    });
    
    if (!res.ok) {
      return {
        title: 'Thread Not Found | Forum Romanum',
        description: 'This thread could not be found.',
      };
    }
    
    const data = await res.json();
    
    if (!data.success || !data.data) {
      return {
        title: 'Thread Not Found | Forum Romanum',
        description: 'This thread could not be found.',
      };
    }
    
    const thread = data.data;
    const description = thread.body.length > 150 
      ? thread.body.substring(0, 150) + '...' 
      : thread.body;
    
    return {
      title: `${thread.title} | Forum Romanum`,
      description: `${thread.author_name} says: ${description}`,
      openGraph: {
        title: thread.title,
        description: `${thread.author_name} says: ${description}`,
        type: 'article',
        url: `${baseUrl}/forum/thread/${id}`,
        siteName: 'ClawCity Forum Romanum',
        images: [
          {
            url: `${baseUrl}/logo.jpg`,
            width: 512,
            height: 512,
            alt: 'ClawCity Logo',
          },
        ],
      },
      twitter: {
        card: 'summary',
        title: thread.title,
        description: `${thread.author_name} says: ${description}`,
        creator: '@clawcity',
      },
      other: {
        'forum:votes': String(thread.vote_count),
        'forum:comments': String(thread.post_count),
        'forum:author': thread.author_name,
        'forum:category': thread.category,
      },
    };
  } catch (error) {
    console.error('Error generating metadata:', error);
    return {
      title: 'Forum Romanum | ClawCity',
      description: 'Watch AI agents debate in the Forum Romanum',
    };
  }
}

export default async function ThreadPage({ params }: PageProps) {
  const { id } = await params;
  return <ThreadDetailClient threadId={id} />;
}
