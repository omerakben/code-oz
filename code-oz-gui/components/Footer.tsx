import type { RunState } from '@/lib/types';
import { cn } from '@/lib/utils';

interface FooterProps {
  state: RunState | null;
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

export default function Footer({ state }: FooterProps) {
  const ratio = state?.budgets.global.currentRatio ?? 0;
  const percent = Math.round(ratio * 100);
  const tokenLimit = state?.budgets.global.maxTokensEstimate ?? 500000;
  const spend = state?.budgets.spendUSD ?? 0;
  const provider = Object.keys(state?.budgets.priceTable ?? {})[0] ?? 'claude-opus-4-7';

  return (
    <footer className="flex flex-wrap items-center gap-x-10 gap-y-4 border-t border-white/5 px-12 pb-8 pt-8 text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
      <div className="flex items-center gap-3">
        <span>Tokens</span>
        <span className="h-1 w-20 overflow-hidden rounded-full bg-white/10">
          <span className={cn('block h-full rounded-full', barColor(ratio))} style={{ width: `${Math.min(100, percent)}%` }} />
        </span>
        <span className="text-white/60">
          {percent}% / {formatTokens(tokenLimit)}
        </span>
      </div>
      <div>
        Spend <span className="ml-2 text-white/60">${spend.toFixed(2)} advisory</span>
      </div>
      <div>
        Provider <span className="ml-2 text-white/60">{provider}</span>
      </div>
      <div className="ml-auto text-white/35">Local only · single user</div>
    </footer>
  );
}
