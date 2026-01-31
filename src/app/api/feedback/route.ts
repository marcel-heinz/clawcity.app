import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { 
  checkRateLimit, 
  rateLimitHeaders, 
  FEEDBACK_RATE_LIMIT 
} from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  // Check rate limit BEFORE processing feedback
  const rateLimitResult = checkRateLimit(request, FEEDBACK_RATE_LIMIT);
  
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { 
        success: false, 
        error: 'Too many feedback submissions. Please try again later.',
        retryAfter: Math.ceil((rateLimitResult.retryAfterMs || 3600000) / 1000),
      },
      { 
        status: 429,
        headers: rateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    const body = await request.json();
    const { title, description, email } = body;

    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    // Validate title length
    if (title.length > 200) {
      return NextResponse.json(
        { error: 'Title must be 200 characters or less' },
        { status: 400 }
      );
    }

    // Validate description length if provided
    if (description && description.length > 2000) {
      return NextResponse.json(
        { error: 'Description must be 2000 characters or less' },
        { status: 400 }
      );
    }

    // Validate email format if provided
    if (email && typeof email === 'string' && email.trim().length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return NextResponse.json(
          { error: 'Invalid email format' },
          { status: 400 }
        );
      }
    }

    const supabase = createServerClient();

    const { error } = await supabase
      .from('feature_requests')
      .insert({
        title: title.trim(),
        description: description?.trim() || null,
        email: email?.trim() || null,
      });

    if (error) {
      console.error('Error inserting feature request:', error);
      return NextResponse.json(
        { error: 'Failed to submit feature request' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, message: 'Feature request submitted successfully' },
      { 
        status: 201,
        headers: rateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error) {
    console.error('Error processing feature request:', error);
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}
