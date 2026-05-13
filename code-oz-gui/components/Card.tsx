'use client';

import { motion } from 'motion/react';
import type { RunCard } from '@/lib/types';
import { cn } from '@/lib/utils';

// TODO(a11y): contrast - text-white/40 on #0a0a0a is about 3.77:1. Revisit subdued metadata colors in v0.2.
interface CardProps {
  card: RunCard;
  active: boolean;
  onClick: () => void;
}

function stateClasses(state: RunCard['state']): string {
  switch (state.kind) {
    case 'pending':
      return 'border-white/5 bg-white/[0.01] opacity-60';
    case 'in-progress':
      return 'border-white/10 bg-white/[0.025]';
    case 'awaiting-approval':
      return 'border-emerald-500/40 bg-emerald-500/[0.04] emerald-glow';
    case 'approved':
      return 'border-white/5 bg-white/[0.02] opacity-70';
    case 'failed':
      return 'border-red-400/40 bg-red-400/[0.04]';
    case 'blocked':
      return 'border-amber-400/40 bg-amber-400/[0.04]';
  }
}

function stateDescriptor(state: RunCard['state']): string {
  switch (state.kind) {
    case 'pending':
      return 'Waiting';
    case 'in-progress':
      return 'Working now';
    case 'awaiting-approval':
      return 'Awaiting your approval';
    case 'approved':
      return 'Approved';
    case 'failed':
      return state.reason;
    case 'blocked':
      return state.reason;
  }
}

function kindLabel(kind: RunCard['kind']): string {
  return kind === 'task' ? 'Task' : kind.toUpperCase();
}

export default function Card({ card, active, onClick }: CardProps) {
  const hasReason = card.state.kind === 'failed' || card.state.kind === 'blocked';
  const reasonColor = card.state.kind === 'failed' ? 'bg-red-400/10 text-red-400' : 'bg-amber-400/10 text-amber-400';

  return (
    <motion.button
      type="button"
      layoutId={card.id}
      onClick={onClick}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={cn(
        'group relative w-full overflow-hidden border p-6 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400',
        stateClasses(card.state),
        active && 'outline outline-1 outline-white/30',
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25">{kindLabel(card.kind)}</span>
        {card.state.kind === 'awaiting-approval' && (
          <span className="whitespace-nowrap rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-400">
            Needs you
          </span>
        )}
      </div>

      <h3 className="line-clamp-2 text-base font-bold tracking-tight text-white">{card.title}</h3>
      <p className="mt-2 truncate text-[11px] font-mono text-white/40">{card.subtitle}</p>
      <p className="mt-3 truncate text-xs text-white/60">{stateDescriptor(card.state)}</p>

      {hasReason && (
        <span className={cn('mt-3 inline-flex max-w-full truncate px-2 py-1 text-[10px] font-medium', reasonColor)}>
          {stateDescriptor(card.state)}
        </span>
      )}

      {card.decisionsCount > 0 && (
        <span className="mt-4 inline-flex text-[10px] font-medium text-white/50">
          {card.decisionsCount} {card.decisionsCount === 1 ? 'decision' : 'decisions'}
        </span>
      )}

      {card.state.kind === 'in-progress' && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-white/5">
          <span className="block h-full w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-card-shimmer" />
        </span>
      )}
    </motion.button>
  );
}
