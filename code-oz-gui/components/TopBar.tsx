'use client';

import { Settings } from 'lucide-react';
import type { RunState } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { RunStreamStatus } from '@/hooks/use-run-stream';

interface TopBarProps {
  repoPath: string | null;
  state: RunState | null;
  status: RunStreamStatus;
  isAborting?: boolean;
  onOpenRepoClick: () => void;
  onAbortRun: () => void;
  onSettingsClick: () => void;
}

function compactPath(path: string | null): string {
  if (!path) {
    return 'No workspace open';
  }

  if (path.length <= 52) {
    return path;
  }

  return `${path.slice(0, 24)}...${path.slice(-24)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return String(value);
}

function barColor(ratio: number): string {
  if (ratio >= 0.95) {
    return 'bg-red-400';
  }

  if (ratio >= 0.75) {
    return 'bg-amber-400';
  }

  return 'bg-white/70';
}

function statusLabel(status: RunStreamStatus): string | null {
  if (status === 'connecting') {
    return 'Connecting...';
  }

  if (status === 'reconnecting') {
    return 'Reconnecting...';
  }

  if (status === 'error') {
    return 'Stream unavailable';
  }

  return null;
}

function lifecycleLabel(state: RunState | null): { readonly label: string; readonly className: string } | null {
  if (!state || state.lifecycle === 'running' || state.lifecycle === 'fixture') {
    return null;
  }

  if (state.lifecycle === 'exited-ok') {
    return { label: 'Exited 0', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' };
  }

  if (state.lifecycle === 'exited-fail') {
    const exitDetail = state.exitCode !== undefined && state.exitCode !== null ? state.exitCode : `(${state.exitSignal ?? 'signal'})`;
    return { label: `Exited ${exitDetail}`, className: 'border-red-500/25 bg-red-500/10 text-red-300' };
  }

  if (state.lifecycle === 'stale') {
    // v0.20.3 #6 — run-registry detected the runDir was removed on disk
    // (e.g., `rm -rf .code-oz/state/`). Surface as "Stale" so the user
    // knows the run is no longer tracked rather than showing "Aborted"
    // (which implies an explicit abort action).
    return { label: 'Stale (runDir removed)', className: 'border-zinc-500/25 bg-zinc-500/10 text-zinc-300' };
  }

  return { label: 'Aborted', className: 'border-amber-500/25 bg-amber-500/10 text-amber-300' };
}

export default function TopBar({
  repoPath,
  state,
  status,
  isAborting = false,
  onOpenRepoClick,
  onAbortRun,
  onSettingsClick,
}: TopBarProps) {
  const ratio = state?.budgets.global.currentRatio ?? 0;
  const percent = Math.round(ratio * 100);
  const tokensSpent = state?.budgets.global.tokensSpent ?? 0;
  const tokenLimit = state?.budgets.global.maxTokensEstimate ?? 500000;
  const spend = state?.budgets.spendUSD ?? 0;
  const connectionLabel = statusLabel(status);
  const lifecyclePill = lifecycleLabel(state);
  const showDemoMode = state?.providerMode === 'fake';

  const copyRepoPath = () => {
    if (repoPath && navigator.clipboard) {
      void navigator.clipboard.writeText(repoPath);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 flex-nowrap items-center justify-between border-b border-white/10 bg-[#050505]/95 px-8 backdrop-blur">
      <div className="flex min-w-0 flex-nowrap items-center gap-5">
        <button
          type="button"
          onClick={onOpenRepoClick}
          className="shrink-0 whitespace-nowrap text-2xl font-black tracking-tighter text-white transition-colors hover:text-emerald-400"
        >
          code OZ
        </button>
        <button
          type="button"
          onClick={copyRepoPath}
          title={repoPath ? 'Copy workspace path' : 'Open a repo to start'}
          className="min-w-0 max-w-[520px] truncate font-mono text-xs text-white/40 transition-colors hover:text-white/70"
        >
          Workspace: {compactPath(repoPath)}
        </button>
        {connectionLabel && (
          <span
            className={cn(
              'text-xs font-medium',
              status === 'reconnecting' || status === 'error' ? 'text-amber-400' : 'text-white/30',
            )}
          >
            {connectionLabel}
          </span>
        )}
        {lifecyclePill && (
          <span className={cn('shrink-0 whitespace-nowrap border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em]', lifecyclePill.className)}>
            {lifecyclePill.label}
          </span>
        )}
        {showDemoMode && (
          <span className="shrink-0 whitespace-nowrap border border-amber-400/40 bg-amber-400/[0.05] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
            Demo mode
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-6">
        {state?.lifecycle === 'running' && (
          <button
            type="button"
            onClick={onAbortRun}
            disabled={isAborting}
            className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-300 transition-colors hover:text-red-200 disabled:cursor-not-allowed disabled:text-white/20"
          >
            {isAborting ? 'Aborting...' : 'Abort'}
          </button>
        )}
        <div className="min-w-[260px]" title={`Soft warning at ${Math.round((state?.budgets.global.softWarnAtRatio ?? 0.75) * 100)}%.`}>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">Tokens</span>
            <div className="h-1 w-28 overflow-hidden rounded-full bg-white/10">
              <div className={cn('h-full rounded-full', barColor(ratio))} style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
            <span className="font-mono text-xs text-white/60">
              {percent}% · {formatTokens(tokensSpent)} / {formatTokens(tokenLimit)}
            </span>
          </div>
          <div className="mt-1 text-right text-[10px] font-medium text-white/30">${spend.toFixed(2)} advisory</div>
        </div>
        <button
          type="button"
          onClick={onSettingsClick}
          aria-label="Settings"
          className="grid h-9 w-9 place-items-center border border-white/10 text-white/40 transition-colors hover:border-white/30 hover:text-white"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
