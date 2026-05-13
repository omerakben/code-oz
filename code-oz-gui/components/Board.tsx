'use client';

import PhaseColumn, { type PhaseColumnConfig } from '@/components/PhaseColumn';
import type { Phase } from '@/lib/event-types';
import type { RunCard } from '@/lib/types';

interface BoardProps {
  cards: readonly RunCard[];
  currentPhase: Phase | null;
  activeCardId: string | null;
  onCardClick: (id: string) => void;
}

export const PHASE_COLUMNS: readonly PhaseColumnConfig[] = [
  { phaseId: 'audit', plainTitle: 'UNDERSTAND', subtitle: 'the problem', techName: 'AUDIT' },
  { phaseId: 'plan', plainTitle: 'PLAN', subtitle: 'the work', techName: 'PLAN' },
  { phaseId: 'build', plainTitle: 'BUILD', subtitle: 'the code', techName: 'BUILD' },
  { phaseId: 'verify', plainTitle: 'VERIFY', subtitle: 'it works', techName: 'VERIFY' },
  { phaseId: 'review', plainTitle: 'REVIEW', subtitle: 'for issues', techName: 'REVIEW' },
  { phaseId: 'ship', plainTitle: 'SHIP', subtitle: 'ready', techName: 'SHIP' },
] as const;

export default function Board({ cards, currentPhase, activeCardId, onCardClick }: BoardProps) {
  return (
    <div className="overflow-x-auto">
      <div className="grid min-h-[500px] min-w-[1640px] grid-cols-6 gap-4">
        {PHASE_COLUMNS.map((column) => (
          <PhaseColumn
            key={column.phaseId}
            {...column}
            cards={cards.filter((card) => card.phase === column.phaseId)}
            activePhase={currentPhase}
            activeCardId={activeCardId}
            onCardClick={onCardClick}
          />
        ))}
      </div>
    </div>
  );
}
