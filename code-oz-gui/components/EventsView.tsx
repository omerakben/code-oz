'use client';

import { useEffect, useRef, useState } from 'react';
import type { PhaseEvent } from '@/lib/event-types';
import { cn } from '@/lib/utils';

interface EventsViewProps {
  runId: string;
  cardId: string | null;
}

type EventFilter = 'all' | 'phase' | 'errors';
type Severity = 'normal' | 'warn' | 'fail';

const FILTERS: readonly { readonly id: EventFilter; readonly label: string }[] = [
  { id: 'all', label: 'All events' },
  { id: 'phase', label: 'Phase only' },
  { id: 'errors', label: 'Errors only' },
] as const;

const PHASE_MILESTONE_EVENT_TYPES = new Set<string>([
  'gate_required',
  'gate_written',
  'audit_completed',
  'plan_completed',
  'verify_completed',
  'build_completed',
  'review_round_completed',
  'effort_envelope_applied',
  'run_started',
  'config_resolved',
]);

const ERROR_EVENT_TYPES = new Set<string>(['intervention', 'budget_warning', 'review_blocked']);

function stringField(event: PhaseEvent, field: string): string | null {
  const value = (event as PhaseEvent & Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

function firstShaField(event: PhaseEvent): string | null {
  for (const [key, value] of Object.entries(event as PhaseEvent & Record<string, unknown>)) {
    if (key.toLowerCase().includes('sha') && typeof value === 'string') {
      return value;
    }
  }

  return null;
}

function joinSummaryParts(parts: readonly (string | null)[], separator: string): string {
  return parts.filter((part): part is string => Boolean(part)).join(separator);
}

function formatEventTime(ts: string): string {
  const date = new Date(ts);

  if (Number.isNaN(date.getTime())) {
    return '[--:--:--]';
  }

  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `[${hours}:${minutes}:${seconds}]`;
}

function summarizeEvent(event: PhaseEvent): string {
  if (event.type === 'phase_entered') {
    return stringField(event, 'phase') ?? '';
  }

  if (event.type === 'repo_context_searched') {
    return joinSummaryParts([stringField(event, 'tool'), stringField(event, 'query')], ' ');
  }

  if (event.type === 'agent_invoked' || event.type === 'agent_completed') {
    return joinSummaryParts([stringField(event, 'agent'), stringField(event, 'provider')], ' · ');
  }

  if (event.type === 'build_provider_recorded') {
    return joinSummaryParts([stringField(event, 'providerFamily'), stringField(event, 'provider'), stringField(event, 'model')], ' · ');
  }

  if (event.type === 'gate_required' || event.type === 'gate_written') {
    return stringField(event, 'phase') ?? '';
  }

  if (event.type === 'hypothesis_added' || event.type === 'question_added') {
    return stringField(event, 'id') ?? '';
  }

  if (event.type.endsWith('_completed')) {
    return firstShaField(event) ?? event.type;
  }

  return '';
}

function shouldShowEvent(event: PhaseEvent, filter: EventFilter): boolean {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'phase') {
    return event.type.startsWith('phase_') || PHASE_MILESTONE_EVENT_TYPES.has(event.type);
  }

  return event.type.endsWith('_failed') || ERROR_EVENT_TYPES.has(event.type);
}

function emptyMessageForFilter(filter: EventFilter): string {
  if (filter === 'phase') {
    return 'No phase milestones yet.';
  }

  if (filter === 'errors') {
    return 'No errors. All clear.';
  }

  return 'No events yet.';
}

function severityFor(eventType: string): Severity {
  if (eventType.endsWith('_failed') || eventType === 'review_blocked') {
    return 'fail';
  }

  if (eventType === 'intervention' || eventType === 'budget_warning') {
    return 'warn';
  }

  return 'normal';
}

export default function EventsView({ runId, cardId }: EventsViewProps) {
  const [events, setEvents] = useState<PhaseEvent[]>([]);
  const [filter, setFilter] = useState<EventFilter>('all');
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const previousLengthRef = useRef(0);

  void cardId;

  useEffect(() => {
    let closed = false;
    const eventSource = new EventSource(`/api/run/${runId}/events`);

    setEvents([]);

    eventSource.addEventListener('append', (message) => {
      if (closed) {
        return;
      }

      try {
        const event = JSON.parse(message.data) as PhaseEvent;
        setEvents((current) => [...current, event]);
      } catch {
        eventSource.close();
      }
    });

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      closed = true;
      eventSource.close();
    };
  }, [runId]);

  useEffect(() => {
    const sentinel = bottomSentinelRef.current;

    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsPinnedToBottom(entry.isIntersecting);
      },
      { root: null, threshold: 0.1 },
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previousLength = previousLengthRef.current;

    if (isPinnedToBottom && events.length > 0) {
      bottomSentinelRef.current?.scrollIntoView({
        block: 'end',
        behavior: previousLength === 0 ? 'auto' : 'smooth',
      });
    }

    previousLengthRef.current = events.length;
  }, [events.length, isPinnedToBottom]);

  useEffect(() => {
    previousLengthRef.current = events.length;
  }, [events.length, filter]);

  const filteredEvents = events.filter((event) => shouldShowEvent(event, filter));

  return (
    <>
      <div className="sticky top-0 z-10 mb-4 flex gap-2 bg-[#101010] py-2">
        {FILTERS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setFilter(chip.id)}
            className={cn(
              'border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors',
              filter === chip.id
                ? 'border-white bg-white/[0.06] text-white'
                : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70',
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {filteredEvents.length === 0 ? (
        <p className="text-sm italic text-white/30">{emptyMessageForFilter(filter)}</p>
      ) : (
        <ol className="font-mono text-xs">
          {filteredEvents.map((event, index) => {
            const severity = severityFor(event.type);

            return (
              <li
                key={`${event.ts}-${event.type}-${index}`}
                className={cn(
                  'grid grid-cols-[10ch_minmax(12ch,1fr)_minmax(0,1.5fr)] gap-x-2 border-b border-white/[0.04] py-1',
                  severity === 'warn' && 'border-l-2 border-l-amber-400/60 bg-amber-400/[0.03] pl-3',
                  severity === 'fail' && 'border-l-2 border-l-red-400/60 bg-red-400/[0.04] pl-3',
                )}
              >
                <time dateTime={event.ts} className="text-white/60">
                  {formatEventTime(event.ts)}
                </time>
                <span className="min-w-0 truncate text-white/80">{event.type}</span>
                <span className="min-w-0 truncate text-white/45">{summarizeEvent(event)}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div ref={bottomSentinelRef} aria-hidden className="h-0 w-0" />

      {!isPinnedToBottom && events.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            bottomSentinelRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
            setIsPinnedToBottom(true);
          }}
          className="fixed bottom-8 right-12 z-20 border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300"
        >
          Jump to live ↓
        </button>
      ) : null}
    </>
  );
}
