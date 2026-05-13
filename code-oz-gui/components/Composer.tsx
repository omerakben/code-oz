'use client';

import { useState, type KeyboardEvent } from 'react';
import { ArrowRight, FolderOpen, PencilLine } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ComposerProps {
  value: string;
  disabled: boolean;
  isSubmitting?: boolean;
  repoPath: string | null;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onOpenRepoClick: () => void;
}

export default function Composer({
  value,
  disabled,
  isSubmitting = false,
  repoPath,
  onValueChange,
  onSubmit,
  onOpenRepoClick,
}: ComposerProps) {
  const [focused, setFocused] = useState(false);
  const hasRepo = Boolean(repoPath);
  const canSubmit = hasRepo && value.trim().length > 0 && !disabled && !isSubmitting;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();

    if (canSubmit) {
      onSubmit(value);
    }
  };

  return (
    <section className="border-b border-white/5 bg-[#050505] px-8 py-4">
      <div className="mx-auto flex max-w-[1800px] items-start gap-4">
        <div className="mt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
          <PencilLine className="h-4 w-4 text-emerald-500/70" />
          <span>Composer</span>
          <span className="hidden text-white/20 xl:inline">Natural-language to action</span>
        </div>

        <div
          className={cn(
            'flex min-h-12 flex-1 items-stretch border bg-white/[0.02] transition-all duration-300',
            focused ? 'min-h-[72px]' : 'min-h-12',
            isSubmitting ? 'border-emerald-500 animate-pulse-emerald' : 'border-white/10',
            !hasRepo && 'opacity-70',
          )}
        >
          <textarea
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            disabled={!hasRepo || disabled || isSubmitting}
            rows={1}
            aria-label="Describe the repo task"
            placeholder={hasRepo ? 'Describe what you want to fix, build, or understand...' : 'Open a repo to start.'}
            className="min-h-full flex-1 resize-none bg-transparent px-4 py-3 text-sm font-medium text-white outline-none placeholder:text-white/20 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={hasRepo ? () => canSubmit && onSubmit(value) : onOpenRepoClick}
            disabled={hasRepo ? !canSubmit : false}
            className="flex min-w-32 items-center justify-center gap-2 border-l border-white/10 px-5 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-20"
          >
            {hasRepo ? (
              <>
                {isSubmitting ? 'Composing...' : 'Compose'}
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Open repo
                <FolderOpen className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
