'use client';

import { CheckCircle2, Hammer, ListTodo, Rocket, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import Card from '@/components/Card';
import type { Phase } from '@/lib/event-types';
import type { RunCard } from '@/lib/types';
import { cn } from '@/lib/utils';

export type PhaseId = 'audit' | 'plan' | 'build' | 'verify' | 'review' | 'ship';

export type PhaseColumnConfig = {
  readonly phaseId: PhaseId;
  readonly plainTitle: string;
  readonly subtitle: string;
  readonly techName: string;
};

interface PhaseColumnProps extends PhaseColumnConfig {
  cards: readonly RunCard[];
  activePhase: Phase | null;
  activeCardId: string | null;
  onCardClick: (id: string) => void;
}

const ICONS: Record<PhaseId, LucideIcon> = {
  audit: Search,
  plan: ListTodo,
  build: Hammer,
  verify: CheckCircle2,
  review: ShieldCheck,
  ship: Rocket,
};

function columnStatus(cards: readonly RunCard[]): { label: string; needsApproval: boolean } {
  if (cards.some((card) => card.state.kind === 'awaiting-approval')) {
    return { label: 'awaiting approval', needsApproval: true };
  }

  if (cards.some((card) => card.state.kind === 'in-progress')) {
    return { label: 'in progress', needsApproval: false };
  }

  if (cards.length > 0 && cards.every((card) => card.state.kind === 'approved')) {
    return { label: 'approved', needsApproval: false };
  }

  if (cards.length > 0) {
    return { label: `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`, needsApproval: false };
  }

  return { label: 'waiting', needsApproval: false };
}

export default function PhaseColumn({
  phaseId,
  plainTitle,
  subtitle,
  techName,
  cards,
  activePhase,
  activeCardId,
  onCardClick,
}: PhaseColumnProps) {
  const Icon = ICONS[phaseId];
  const isActivePhase = activePhase === phaseId;
  const status = columnStatus(cards);

  return (
    <section className="flex min-h-[500px] min-w-[260px] flex-col border border-white/5 bg-[#0a0a0a]/80">
      <header className="border-b border-white/5 p-4">
        <div className="flex items-start gap-2">
          <Icon className={cn('mt-0.5 h-3.5 w-3.5', isActivePhase ? 'text-emerald-500/70' : 'text-white/30')} />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">{plainTitle}</h2>
            <p className="mt-1 text-xs italic text-white/40">{subtitle}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/25">
          <span>{techName}</span>
          <span>·</span>
          <span className="normal-case tracking-normal">{status.label}</span>
          <span
            className={cn(
              'ml-auto text-[10px]',
              status.needsApproval
                ? 'animate-pulse text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.6)]'
                : 'text-white/15',
            )}
          >
            ●
          </span>
        </div>
      </header>

      <div className={cn('flex flex-1 flex-col p-3', cards.length > 0 ? 'space-y-3' : 'items-center justify-center border border-dashed border-white/[0.03]')}>
        {cards.length > 0 ? (
          cards.map((card) => (
            <Card key={card.id} card={card} active={activeCardId === card.id} onClick={() => onCardClick(card.id)} />
          ))
        ) : (
          <p className="text-xs italic text-white/15">nothing here yet</p>
        )}
      </div>
    </section>
  );
}
