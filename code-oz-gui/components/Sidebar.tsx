'use client';

interface SidebarProps {
  repoPath: string | null;
  hasRun: boolean;
  onSwitchWorkspace: () => void;
  onResumeRun: () => void;
}

function formatPath(path: string | null): string {
  if (!path) {
    return 'No workspace open';
  }

  if (path.length <= 34) {
    return path;
  }

  return `${path.slice(0, 16)}...${path.slice(-15)}`;
}

export default function Sidebar({ repoPath, hasRun, onSwitchWorkspace, onResumeRun }: SidebarProps) {
  return (
    <aside className="w-72 shrink-0 border-r border-white/10 bg-black/20 p-6">
      <nav className="space-y-12">
        <section>
          <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-2">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Workspace</h2>
            <button
              type="button"
              onClick={onSwitchWorkspace}
              className="text-[10px] font-bold uppercase tracking-widest text-white/30 transition-colors hover:text-white"
            >
              Switch
            </button>
          </div>
          <p className="break-all font-mono text-xs leading-relaxed text-white/40">{formatPath(repoPath)}</p>
        </section>

        <section>
          <h2 className="mb-4 border-b border-white/5 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
            Run history
          </h2>
          {hasRun ? (
            <button
              type="button"
              onClick={onResumeRun}
              className="block w-full border border-white/5 bg-white/[0.02] p-3 text-left transition-colors hover:border-white/15"
            >
              <span className="block text-sm font-bold tracking-tight text-white">Audit</span>
              <span className="mt-1 block text-[10px] font-mono uppercase tracking-[0.18em] text-white/30">
                today · in progress
              </span>
            </button>
          ) : (
            <p className="text-xs italic text-white/20">No runs yet.</p>
          )}
        </section>

        <section>
          <h2 className="mb-4 border-b border-white/5 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
            Library
          </h2>
          <p className="text-xs italic text-white/20">(saved actions will appear here)</p>
        </section>
      </nav>
    </aside>
  );
}
