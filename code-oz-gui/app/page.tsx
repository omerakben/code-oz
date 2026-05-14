'use client';

import { useMemo, useState } from 'react';
import Board, { PHASE_COLUMNS } from '@/components/Board';
import Composer from '@/components/Composer';
import Drawer from '@/components/Drawer';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import { useRunStream } from '@/hooks/use-run-stream';
import type { RunCard } from '@/lib/types';

const FIXTURE_RUN_ID = 'r-2026-05-12-checkout-safari';
type ProviderMode = 'fake' | 'real';

export default function Home() {
  const [repoPath, setRepoPath] = useState<string | null>('./fixtures/sample-run');
  const [runId, setRunId] = useState<string | null>(FIXTURE_RUN_ID);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWorkspaceFormOpen, setIsWorkspaceFormOpen] = useState(false);
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [runStartError, setRunStartError] = useState<string | null>(null);
  const [isAborting, setIsAborting] = useState(false);
  const [providerMode, setProviderMode] = useState<ProviderMode>('fake');

  const { state, events, status } = useRunStream(runId);

  const activeCard = useMemo<RunCard | null>(() => {
    if (!activeCardId || !state) {
      return null;
    }

    return state.cards.find((card) => card.id === activeCardId) ?? null;
  }, [activeCardId, state]);

  const openRepo = () => {
    setWorkspaceInput(repoPath && repoPath !== './fixtures/sample-run' ? repoPath : '');
    setWorkspaceError(null);
    setIsWorkspaceFormOpen(true);
  };

  const useSampleFixture = () => {
    setRepoPath('./fixtures/sample-run');
    setRunId(FIXTURE_RUN_ID);
    setActiveCardId(null);
    setWorkspaceError(null);
    setIsWorkspaceFormOpen(false);
    setRunStartError(null);
  };

  const applyWorkspacePath = () => {
    const nextRepoPath = workspaceInput.trim();

    if (!nextRepoPath) {
      setWorkspaceError('Enter an absolute repo path.');
      return;
    }

    if (!nextRepoPath.startsWith('/')) {
      setWorkspaceError('Repo path must be absolute.');
      return;
    }

    setRepoPath(nextRepoPath);
    setRunId(null);
    setActiveCardId(null);
    setWorkspaceError(null);
    setIsWorkspaceFormOpen(false);
    setRunStartError(null);
  };

  const handleComposerSubmit = async (value: string) => {
    if (!repoPath || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setRunStartError(null);

    try {
      const response = await fetch('/api/run/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: value,
          repoPath,
          providerOverride: providerMode === 'fake' ? 'fake' : null,
        }),
      });

      if (response.ok) {
        const body = (await response.json()) as { runId: string };
        setRunId(body.runId);
        setComposerValue('');
        return;
      }

      if (response.status === 503) {
        const body = (await response.json().catch(() => null)) as { readonly detail?: unknown } | null;
        const detail = typeof body?.detail === 'string' ? body.detail : 'Unable to start code-oz.';
        setRunStartError(detail);
        setTimeout(() => {
          setRunStartError((current) => (current === detail ? null : current));
        }, 5000);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const abortRun = async () => {
    if (!runId || isAborting) {
      return;
    }

    setIsAborting(true);

    try {
      await fetch(`/api/run/${runId}/abort`, { method: 'POST' });
    } finally {
      setIsAborting(false);
    }
  };

  const providerModeControl = (
    <div className="my-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={() => setProviderMode('fake')}
        aria-pressed={providerMode === 'fake'}
        className={`border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors ${
          providerMode === 'fake'
            ? 'border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-300'
            : 'border-white/10 text-white/40 hover:text-white/70'
        }`}
      >
        Cost-free demo
      </button>
      <button
        type="button"
        onClick={() => setProviderMode('real')}
        aria-pressed={providerMode === 'real'}
        className={`border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors ${
          providerMode === 'real'
            ? 'border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-300'
            : 'border-white/10 text-white/40 hover:text-white/70'
        }`}
      >
        Real providers (CLI auth)
      </button>
    </div>
  );

  if (!repoPath) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#050505] p-12 text-white">
        <section className="text-center">
          <h1 className="select-none text-[120px] font-black leading-[0.8] tracking-tighter">
            CODE
            <br />
            OZ
          </h1>
          <div className="mt-10">
            <p className="mb-5 text-sm text-white/50">Open a repo to start</p>
            <button
              type="button"
              onClick={openRepo}
              className="border border-white/20 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black"
            >
              Open repo
            </button>
            {isWorkspaceFormOpen && (
              <form
                className="mx-auto mt-5 max-w-xl text-left"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyWorkspacePath();
                }}
              >
                <div className="border border-white/10 bg-white/[0.02]">
                  <input
                    value={workspaceInput}
                    onChange={(event) => setWorkspaceInput(event.target.value)}
                    aria-label="Workspace repo path"
                    placeholder="/absolute/path/to/your/repo"
                    className="w-full bg-transparent px-4 py-3 font-mono text-xs text-white outline-none placeholder:text-white/20"
                  />
                </div>
                {providerModeControl}
                <button
                  type="submit"
                  className="w-full border border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black"
                >
                  Use this repo →
                </button>
                {workspaceError && <p className="mt-2 text-xs text-red-400">{workspaceError}</p>}
                <button
                  type="button"
                  onClick={useSampleFixture}
                  className="mt-3 text-[10px] font-bold uppercase tracking-widest text-white/40 transition-colors hover:text-white"
                >
                  Use sample fixture
                </button>
              </form>
            )}
          </div>
        </section>
      </main>
    );
  }

  const boardCards = state?.cards ?? [];
  const currentPhase = state?.currentPhase ?? null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#050505] text-white">
      <Sidebar repoPath={repoPath} hasRun={Boolean(runId)} onSwitchWorkspace={openRepo} onResumeRun={() => setRunId(FIXTURE_RUN_ID)} />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          repoPath={repoPath}
          state={state}
          status={status}
          isAborting={isAborting}
          onOpenRepoClick={openRepo}
          onAbortRun={abortRun}
          onSettingsClick={() => undefined}
        />

        <Composer
          value={composerValue}
          disabled={status === 'connecting' || status === 'reconnecting'}
          isSubmitting={isSubmitting}
          repoPath={repoPath}
          onValueChange={setComposerValue}
          onSubmit={handleComposerSubmit}
          onOpenRepoClick={openRepo}
        />

        {runStartError && (
          <p className="border-b border-white/5 px-8 py-2 text-xs text-red-300">
            {runStartError}
          </p>
        )}

        {isWorkspaceFormOpen && (
          <section className="border-b border-white/5 bg-[#050505] px-8 py-4">
            <form
              className="mx-auto max-w-[1800px]"
              onSubmit={(event) => {
                event.preventDefault();
                applyWorkspacePath();
              }}
            >
              <div className="border border-white/10 bg-white/[0.02]">
                <input
                  value={workspaceInput}
                  onChange={(event) => setWorkspaceInput(event.target.value)}
                  aria-label="Workspace repo path"
                  placeholder="/absolute/path/to/your/repo"
                  className="w-full bg-transparent px-4 py-3 font-mono text-xs text-white outline-none placeholder:text-white/20"
                />
              </div>
              {providerModeControl}
              <button
                type="submit"
                className="border border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black"
                >
                Use this repo →
              </button>
              {workspaceError && <p className="mt-2 text-xs text-red-400">{workspaceError}</p>}
              <button
                type="button"
                onClick={useSampleFixture}
                className="mt-3 text-[10px] font-bold uppercase tracking-widest text-white/40 transition-colors hover:text-white"
              >
                Use sample fixture
              </button>
            </form>
          </section>
        )}

        <section className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-[1800px]">
            {!runId ? (
              <>
                <p className="mb-5 text-center text-sm text-white/40">
                  Describe what you want to fix, build, or understand in the bar above.
                </p>
                <Board cards={[]} currentPhase={null} activeCardId={activeCardId} onCardClick={setActiveCardId} />
              </>
            ) : state ? (
              <Board cards={boardCards} currentPhase={currentPhase} activeCardId={activeCardId} onCardClick={setActiveCardId} />
            ) : (
              <Board
                cards={[
                  {
                    id: 'audit-pending',
                    kind: 'audit',
                    phase: 'audit',
                    title: 'Audit',
                    subtitle: 'AUDIT.md',
                    state: { kind: 'in-progress', startedAt: '' },
                    artifactPath: 'AUDIT.md',
                    decisionsCount: 0,
                  },
                ]}
                currentPhase="audit"
                activeCardId={activeCardId}
                onCardClick={setActiveCardId}
              />
            )}
          </div>
        </section>

        <Footer state={state} />
      </main>

      <Drawer runId={runId} card={activeCard} onClose={() => setActiveCardId(null)} />

      <span className="sr-only" aria-live="polite">
        {events.length} events loaded across {PHASE_COLUMNS.length} phases.
      </span>
    </div>
  );
}
