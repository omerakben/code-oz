'use client';

import { useEffect, useRef, useState } from 'react';
import type { Phase, PhaseEnteredEvent, PhaseEvent } from '@/lib/event-types';
import type { RunState } from '@/lib/types';

export type RunStreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

const PHASES = new Set<Phase>(['define', 'audit', 'plan', 'build', 'verify', 'review', 'ship']);

function isPhaseEnteredEvent(event: PhaseEvent): event is PhaseEnteredEvent {
  return event.type === 'phase_entered' && typeof event.phase === 'string' && PHASES.has(event.phase as Phase);
}

export function useRunStream(runId: string | null): {
  state: RunState | null;
  events: PhaseEvent[];
  status: RunStreamStatus;
} {
  const [state, setState] = useState<RunState | null>(null);
  const [events, setEvents] = useState<PhaseEvent[]>([]);
  const [status, setStatus] = useState<RunStreamStatus>('idle');
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!runId) {
      setState(null);
      setEvents([]);
      setStatus('idle');
      return;
    }

    let closed = false;
    let eventSource: EventSource | null = null;
    let hasOpened = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const clearRefreshTimer = () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };

    const applyEventToState = (event: PhaseEvent) => {
      setState((current) => {
        if (!current) {
          return current;
        }

        if (isPhaseEnteredEvent(event)) {
          return {
            ...current,
            currentPhase: event.phase,
            lastEventAt: event.ts,
          };
        }

        return {
          ...current,
          lastEventAt: event.ts,
        };
      });
    };

    const connect = () => {
      if (closed) {
        return;
      }

      setStatus(hasOpened ? 'reconnecting' : 'connecting');
      eventSource = new EventSource(`/api/run/${runId}/events`);

      eventSource.onopen = () => {
        if (!closed) {
          hasOpened = true;
          setStatus('live');
        }
      };

      eventSource.addEventListener('append', (message) => {
        if (closed) {
          return;
        }

        try {
          const event = JSON.parse(message.data) as PhaseEvent;
          setEvents((current) => [...current, event]);
          applyEventToState(event);
          setStatus('live');
        } catch {
          setStatus('error');
        }
      });

      eventSource.onerror = () => {
        if (closed) {
          return;
        }

        eventSource?.close();
        eventSource = null;
        setStatus('reconnecting');
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(connect, 2000);
      };
    };

    const refreshState = async () => {
      try {
        const response = await fetch(`/api/run/${runId}/state`);

        if (!response.ok) {
          return;
        }

        const snapshot = (await response.json()) as RunState;

        if (!closed) {
          setState(snapshot);
        }
      } catch {
        // EventSource owns connection status; lifecycle refresh is best-effort.
      }
    };

    const loadSnapshot = async () => {
      setStatus('connecting');
      setEvents([]);

      try {
        const response = await fetch(`/api/run/${runId}/state`);

        if (!response.ok) {
          throw new Error(`State request failed: ${response.status}`);
        }

        const snapshot = (await response.json()) as RunState;

        if (!closed) {
          setState(snapshot);
          connect();
          clearRefreshTimer();
          refreshTimerRef.current = setInterval(() => {
            void refreshState();
          }, 2000);
        }
      } catch {
        if (!closed) {
          setStatus('error');
        }
      }
    };

    void loadSnapshot();

    return () => {
      closed = true;
      clearReconnectTimer();
      clearRefreshTimer();
      eventSource?.close();
      eventSource = null;
    };
  }, [runId]);

  return { state, events, status };
}
