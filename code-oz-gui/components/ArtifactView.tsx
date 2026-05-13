'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import type { PluggableList } from 'unified';
import type { PhaseEvent } from '@/lib/event-types';
import type { RunCard } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ArtifactViewProps {
  runId: string;
  artifactPath: string;
  cardKind: RunCard['kind'];
}

type Provenance = {
  readonly artifactName: string;
  readonly sha: string;
  readonly ts: string;
};

const CITATION_REGEX = /([\w/.-]+\.\w+):(\d+)(?:-(\d+))?/g;
const FRONTMATTER_TYPES = ['yaml', 'toml'];
const REMARK_PLUGINS: PluggableList = [remarkGfm, [remarkFrontmatter, FRONTMATTER_TYPES]];

function splitArtifactPath(artifactPath: string): { artifactName: string; fragment: string | null } {
  const [artifactName, fragment] = artifactPath.split('#');
  return { artifactName, fragment: fragment ?? null };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function shortSha(sha: string): string {
  if (sha.length <= 12) {
    return sha;
  }

  return `${sha.slice(0, 4)}…${sha.slice(-4)}`;
}

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

function findLastEvent(
  events: readonly PhaseEvent[],
  predicate: (event: PhaseEvent) => boolean,
): PhaseEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) {
      return events[index];
    }
  }

  return null;
}

function findProvenance(input: {
  readonly events: readonly PhaseEvent[];
  readonly artifactName: string;
  readonly fragment: string | null;
  readonly cardKind: RunCard['kind'];
}): Provenance | null {
  if (input.cardKind === 'audit') {
    const event = findLastEvent(input.events, (candidate) => candidate.type === 'audit_completed');
    const sha = event ? stringField(event, 'auditReportSha256') : null;
    return event && sha ? { artifactName: input.artifactName, sha, ts: event.ts } : null;
  }

  if (input.cardKind === 'plan') {
    const event = findLastEvent(input.events, (candidate) => candidate.type === 'plan_completed');
    const sha = event ? stringField(event, 'planSha256') ?? firstShaField(event) : null;
    return event && sha ? { artifactName: input.artifactName, sha, ts: event.ts } : null;
  }

  if (input.cardKind === 'task' && input.artifactName === 'BUILD_REPORT.md' && input.fragment) {
    const event = findLastEvent(
      input.events,
      (candidate) => candidate.type === 'build_completed' && stringField(candidate, 'taskId') === input.fragment,
    );
    const sha = event ? stringField(event, 'buildReportSha256') ?? firstShaField(event) : null;
    return event && sha ? { artifactName: input.artifactName, sha, ts: event.ts } : null;
  }

  return null;
}

function logOpenInEditor(citation: string): void {
  console.info('open-in-editor', citation);
}

function renderCitationButton(citation: string, key: string): ReactNode {
  return (
    <button
      key={key}
      type="button"
      onClick={() => logOpenInEditor(citation)}
      className="font-mono text-emerald-300 underline-offset-4 transition-colors hover:text-emerald-200 hover:underline"
    >
      {citation}
    </button>
  );
}

function linkifyText(text: string, keyPrefix: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const [citationIndex, match] of Array.from(text.matchAll(CITATION_REGEX)).entries()) {
    const index = match.index ?? 0;
    const [citation] = match;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    nodes.push(renderCitationButton(citation, `${keyPrefix}-citation-${citationIndex}`));
    lastIndex = index + citation.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : text;
}

function linkifyChildren(children: ReactNode, keyPrefix: string): ReactNode {
  if (typeof children === 'string') {
    return linkifyText(children, keyPrefix);
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={`${keyPrefix}-${index}`}>{linkifyChildren(child, `${keyPrefix}-${index}`)}</Fragment>
    ));
  }

  return children;
}

const markdownComponents: Components = {
  h2({ children }) {
    return <h2 className="text-base uppercase tracking-[0.2em] text-white/50 mt-8 mb-3 font-bold">{children}</h2>;
  },
  code({ children, className }) {
    const text = String(children);
    const isBlock = text.includes('\n') || Boolean(className?.startsWith('language-'));

    if (isBlock) {
      return (
        <code className={cn('bg-white/[0.04] px-1.5 py-0.5 rounded text-xs font-mono', className)}>
          {children}
        </code>
      );
    }

    return (
      <code className="bg-white/[0.04] px-1.5 py-0.5 rounded text-xs font-mono">
        {linkifyText(text, `code-${text}`)}
      </code>
    );
  },
  pre({ children }) {
    return <pre className="bg-black/40 p-4 rounded border border-white/5">{children}</pre>;
  },
  p({ children }) {
    return <p>{linkifyChildren(children, 'p')}</p>;
  },
  li({ children }) {
    return <li>{linkifyChildren(children, 'li')}</li>;
  },
};

export default function ArtifactView({ runId, artifactPath, cardKind }: ArtifactViewProps) {
  const { artifactName, fragment } = useMemo(() => splitArtifactPath(artifactPath), [artifactPath]);
  const [markdown, setMarkdown] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [events, setEvents] = useState<PhaseEvent[]>([]);
  const [sections, setSections] = useState<Array<{ readonly id: string; readonly title: string }>>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const initialFragmentScrollRef = useRef<string | null>(null);

  useEffect(() => {
    let closed = false;

    const loadArtifact = async () => {
      setLoadError(null);
      setMarkdown('');

      try {
        const response = await fetch(`/api/run/${runId}/artifact/${encodeURIComponent(artifactName)}`);

        if (!response.ok) {
          throw new Error(`Artifact request failed: ${response.status}`);
        }

        const text = await response.text();

        if (!closed) {
          setMarkdown(text);
        }
      } catch (error) {
        if (!closed) {
          setLoadError(error instanceof Error ? error.message : 'Artifact request failed');
        }
      }
    };

    void loadArtifact();

    return () => {
      closed = true;
    };
  }, [artifactName, runId]);

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
    initialFragmentScrollRef.current = null;
  }, [artifactPath]);

  useEffect(() => {
    const article = articleRef.current;

    if (!article || !markdown) {
      setSections([]);
      setActiveSectionId(null);
      return;
    }

    const headings = Array.from(article.querySelectorAll<HTMLHeadingElement>('h2'));
    const nextSections = headings.map((heading, index) => {
      const title = heading.textContent?.trim() || `Section ${index + 1}`;
      const id = `${slugify(title) || 'section'}-${index}`;
      heading.id = id;
      return { id, title };
    });

    setSections(nextSections);
    setActiveSectionId(nextSections[0]?.id ?? null);

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];

        if (visibleEntry?.target.id) {
          setActiveSectionId(visibleEntry.target.id);
        }
      },
      { root: null, rootMargin: '-20% 0px -65% 0px', threshold: [0, 1] },
    );

    headings.forEach((heading) => observer.observe(heading));

    return () => observer.disconnect();
  }, [markdown]);

  useEffect(() => {
    if (!fragment || sections.length === 0 || initialFragmentScrollRef.current === artifactPath) {
      return;
    }

    const targetSection = sections.find((section) => section.title.toLowerCase().startsWith(fragment.toLowerCase()));

    if (targetSection) {
      document.getElementById(targetSection.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSectionId(targetSection.id);
    }

    initialFragmentScrollRef.current = artifactPath;
  }, [artifactPath, fragment, sections]);

  const provenance = useMemo(
    () => findProvenance({ events, artifactName, fragment, cardKind }),
    [artifactName, cardKind, events, fragment],
  );

  if (loadError) {
    return (
      <div className="border border-red-400/20 bg-red-400/[0.03] p-6">
        <p className="text-sm text-red-300">Artifact unavailable.</p>
        <p className="mt-3 font-mono text-xs text-white/35">{loadError}</p>
      </div>
    );
  }

  if (!markdown) {
    return (
      <div className="border border-white/5 bg-white/[0.02] p-6">
        <p className="text-sm text-white/50">Loading artifact.</p>
        <p className="mt-3 font-mono text-xs text-white/30">{artifactPath}</p>
      </div>
    );
  }

  return (
    <section className="min-h-full">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs text-white/35">{artifactPath}</p>
        </div>
        {provenance && (
          <span
            title={`${provenance.sha} · ${provenance.ts}`}
            className="shrink-0 border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-white/45"
          >
            {provenance.artifactName} · sha: {shortSha(provenance.sha)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-5">
        <nav aria-label="Artifact sections" className="sticky top-0 h-fit border-r border-white/5 pr-3">
          <div className="space-y-3">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={cn(
                  'block w-full break-words text-left text-[10px] font-bold uppercase leading-snug tracking-[0.1em] transition-colors',
                  activeSectionId === section.id ? 'text-white' : 'text-white/40 hover:text-white/70',
                )}
              >
                {section.title}
              </button>
            ))}
          </div>
        </nav>

        <article
          ref={articleRef}
          className="prose prose-invert max-w-none prose-p:text-white/70 prose-li:text-white/70 prose-strong:text-white prose-a:text-emerald-300 prose-code:before:content-none prose-code:after:content-none"
        >
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} disallowedElements={[...FRONTMATTER_TYPES]} components={markdownComponents}>
            {markdown}
          </ReactMarkdown>
        </article>
      </div>
    </section>
  );
}
