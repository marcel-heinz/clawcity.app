'use client';

import { useState, useEffect, useCallback } from 'react';

interface FeatureRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FeatureRequestModal({ isOpen, onClose }: FeatureRequestModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setEmail('');
      setStatus('idle');
      setErrorMessage('');
    }
  }, [isOpen]);

  // Handle escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      setStatus('error');
      setErrorMessage('Please enter a title for your feature request');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          email: email.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit');
      }

      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* Modal */}
      <div className="relative w-full max-w-md pixel-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b-2 border-[var(--border)]">
          <h2 className="text-lg font-bold flex items-center gap-2 text-[var(--foreground)]">
            <span>💡</span> Feature Request
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-alt)] transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {status === 'success' ? (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="text-xl font-bold text-[var(--accent)] mb-2">Thank you!</h3>
              <p className="text-[var(--muted)] mb-6">
                Your feature request has been submitted successfully.
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-[var(--accent)] text-white font-semibold hover:opacity-90 transition-opacity"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Title */}
              <div>
                <label htmlFor="title" className="block text-sm font-medium mb-1.5 text-[var(--foreground)]">
                  Title <span className="text-[var(--red)]">*</span>
                </label>
                <input
                  type="text"
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What feature would you like to see?"
                  maxLength={200}
                  className="w-full px-3 py-2 bg-[var(--surface-alt)] border-2 border-[var(--border)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  disabled={status === 'loading'}
                />
                <div className="text-xs text-[var(--muted)] mt-1 text-right">
                  {title.length}/200
                </div>
              </div>

              {/* Description */}
              <div>
                <label htmlFor="description" className="block text-sm font-medium mb-1.5 text-[var(--foreground)]">
                  Description <span className="text-[var(--muted)]">(optional)</span>
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tell us more about your idea..."
                  maxLength={2000}
                  rows={4}
                  className="w-full px-3 py-2 bg-[var(--surface-alt)] border-2 border-[var(--border)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none"
                  disabled={status === 'loading'}
                />
                <div className="text-xs text-[var(--muted)] mt-1 text-right">
                  {description.length}/2000
                </div>
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-1.5 text-[var(--foreground)]">
                  Email <span className="text-[var(--muted)]">(optional)</span>
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Get notified when implemented"
                  className="w-full px-3 py-2 bg-[var(--surface-alt)] border-2 border-[var(--border)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  disabled={status === 'loading'}
                />
              </div>

              {/* Error message */}
              {status === 'error' && errorMessage && (
                <div className="p-3 bg-[var(--red-light)] border-2 border-[var(--red)] text-[var(--red)] text-sm">
                  {errorMessage}
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full py-2.5 bg-[var(--accent)] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {status === 'loading' ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Submitting...
                  </>
                ) : (
                  <>
                    <span>🚀</span>
                    Submit Request
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
