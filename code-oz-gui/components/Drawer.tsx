'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import AIHelper from '@/components/AIHelper';
import ArtifactView from '@/components/ArtifactView';
import DecisionsView from '@/components/DecisionsView';
import EventsView from '@/components/EventsView';
import type { RunCard } from '@/lib/types';
import { cn } from '@/lib/utils';

interface DrawerProps {
  runId: string | null;
  card: RunCard | null;
  onClose: () => void;
}

type DrawerTab = 'artifact' | 'events' | 'decisions';

const TABS: readonly { id: DrawerTab; label: string; placeholder: string }[] = [
  { id: 'artifact', label: 'Artifact', placeholder: 'Artifact unavailable.' },
  { id: 'events', label: 'Events', placeholder: 'Events stream view lands in step 6.' },
  { id: 'decisions', label: 'Decisions', placeholder: 'Decision rows land in step 7.' },
] as const;
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function kindLabel(kind: RunCard['kind']): string {
  return kind === 'task' ? 'Task' : kind.toUpperCase();
}

export default function Drawer({ runId, card, onClose }: DrawerProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('artifact');
  const cardId = card?.id ?? null;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const tabRefs = useRef<Record<DrawerTab, HTMLButtonElement | null>>({
    artifact: null,
    events: null,
    decisions: null,
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!cardId) {
      return;
    }

    setActiveTab('artifact');
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !drawerRef.current) {
        return;
      }

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [cardId]);

  const activeTabConfig = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];

  const handleTabListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    const lastIndex = TABS.length - 1;
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = lastIndex;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextTab = TABS[nextIndex].id;
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  return (
    <AnimatePresence>
      {card && (
        <div className="fixed inset-0 z-50">
          <motion.button
            type="button"
            aria-label="Close drawer"
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
          />
          <motion.aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
            className="absolute right-0 top-0 flex h-full w-full flex-col bg-[#101010] shadow-2xl outline-none xl:w-[520px]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
          >
            <header className="sticky top-0 border-b border-white/10 bg-[#101010] p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="mb-3 inline-flex border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/65">
                    {kindLabel(card.kind)}
                  </span>
                  <h2 id="drawer-title" className="text-wrap-safe text-2xl font-bold tracking-tight text-white">
                    {card.title}
                  </h2>
                  <p className="mt-2 break-all font-mono text-xs text-white/65">{card.subtitle}</p>
                </div>
                <button
                  type="button"
                  ref={closeButtonRef}
                  onClick={onClose}
                  aria-label="Close drawer"
                  className="grid h-9 w-9 shrink-0 place-items-center border border-white/10 text-white/40 transition-colors hover:border-white/30 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div
                role="tablist"
                aria-label="Drawer content"
                onKeyDown={handleTabListKeyDown}
                className="mt-8 flex gap-6 border-b border-white/10"
              >
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    ref={(element) => {
                      tabRefs.current[tab.id] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`drawer-tab-${tab.id}`}
                    aria-selected={activeTab === tab.id}
                    aria-controls={`drawer-panel-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      '-mb-px border-b px-0 pb-3 text-sm font-bold tracking-tight transition-colors',
                      activeTab === tab.id
                        ? 'border-white text-white'
                        : 'border-transparent text-white/65 hover:text-white/80',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  role="tabpanel"
                  id={`drawer-panel-${activeTab}`}
                  aria-labelledby={`drawer-tab-${activeTab}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className={cn(
                    activeTab === 'artifact' || activeTab === 'events' || activeTab === 'decisions'
                      ? 'min-h-full'
                      : 'border border-white/5 bg-white/[0.02] p-6',
                  )}
                >
                  {activeTab === 'artifact' && runId ? (
                    <ArtifactView runId={runId} artifactPath={card.artifactPath} cardKind={card.kind} />
                  ) : activeTab === 'events' && runId ? (
                    <EventsView runId={runId} cardId={card.id} />
                  ) : activeTab === 'decisions' && runId ? (
                    <DecisionsView runId={runId} card={card} />
                  ) : (
                    <>
                      <p className="text-sm text-white/60">{activeTabConfig.placeholder}</p>
                      <p className="mt-3 font-mono text-xs text-white/30">{card.artifactPath}</p>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {runId ? <AIHelper runId={runId} card={card} currentTab={activeTab} /> : null}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
