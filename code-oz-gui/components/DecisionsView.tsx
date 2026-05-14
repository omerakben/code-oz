'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Phase, PhaseEvent } from '@/lib/event-types';
import type { RunCard } from '@/lib/types';
import { cn } from '@/lib/utils';

type Decision =
  | {
      readonly kind: 'gate-approval';
      readonly id: string;
      readonly title: string;
      readonly status: 'open' | 'resolved';
      readonly bodyParagraphs: readonly string[];
      readonly primaryCtaLabel: string;
      readonly secondaryCtaLabel: string;
      readonly whyShouldICare: string;
    }
  | {
      readonly kind: 'ai-verdict';
      readonly id: string;
      readonly title: string;
      readonly verdict: 'ready' | 'fix-first' | 'debate-required';
      readonly status: 'open' | 'resolved';
      readonly bodyParagraphs: readonly string[];
    }
  | {
      readonly kind: 'debate-outcome';
      readonly id: string;
      readonly title: string;
      readonly status: 'resolved';
      readonly bodyParagraphs: readonly string[];
    }
  | {
      readonly kind: 'open-question';
      readonly id: string;
      readonly title: string;
      readonly status: 'open' | 'resolved';
      readonly overdue: boolean;
      readonly bodyParagraphs: readonly string[];
    }
  | {
      readonly kind: 'budget-warning';
      readonly id: string;
      readonly title: string;
      readonly status: 'open' | 'resolved';
      readonly ratio: number;
      readonly bodyParagraphs: readonly string[];
    };

interface DecisionsViewProps {
  runId: string;
  card: RunCard;
}

type SubmitState = 'idle' | 'submitting' | 'error' | 'ok';

type DecisionActionPayload =
  | {
      readonly runId: string;
      readonly phase: Phase;
      readonly taskId?: string;
      readonly action: 'approve';
    }
  | {
      readonly runId: string;
      readonly phase: Phase;
      readonly taskId?: string;
      readonly action: 'revise';
      readonly feedback: string;
    }
  | {
      readonly runId: string;
      readonly phase: Phase;
      readonly action: 'answer-question';
      readonly questionId: string;
      readonly answer: string;
    }
  | {
      readonly runId: string;
      readonly phase: Phase;
      readonly action: 'skip-question';
      readonly questionId: string;
    };

const PHASES = new Set<Phase>(['define', 'audit', 'plan', 'build', 'verify', 'review', 'ship']);
const EMERALD_BUTTON_CLASS =
  'w-full bg-emerald-500 px-5 py-2.5 font-bold tracking-tight text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50';
const TEXT_BUTTON_CLASS = 'text-white/40 transition-colors hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50';
const TEXTAREA_CLASS =
  'w-full bg-black/40 border border-white/10 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-50';

function eventRecord(event: PhaseEvent): PhaseEvent & Record<string, unknown> {
  return event as PhaseEvent & Record<string, unknown>;
}

function phaseForEvent(event: PhaseEvent): Phase | null {
  const phase = eventRecord(event).phase;
  return typeof phase === 'string' && PHASES.has(phase as Phase) ? phase as Phase : null;
}

function stringField(event: PhaseEvent, field: string): string | null {
  const value = eventRecord(event)[field];
  return typeof value === 'string' ? value : null;
}

function stringArrayField(event: PhaseEvent, field: string): readonly string[] {
  const value = eventRecord(event)[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberField(event: PhaseEvent, field: string): number | null {
  const value = eventRecord(event)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function taskIdForEvent(event: PhaseEvent): string | null {
  return stringField(event, 'taskId') ?? stringField(event, 'parentTaskId');
}

function isGateRequired(event: PhaseEvent): boolean {
  return event.type === 'gate_required';
}

function isGateWritten(event: PhaseEvent): boolean {
  return event.type === 'gate_written';
}

function isTaskCardEventMatch(event: PhaseEvent, card: RunCard): boolean {
  if (card.kind !== 'task') {
    return true;
  }

  const taskId = taskIdForEvent(event);
  return taskId === null || taskId === card.id;
}

function gateMatchesCard(event: PhaseEvent, card: RunCard): boolean {
  return phaseForEvent(event) === card.phase && isTaskCardEventMatch(event, card);
}

function gateWrittenMatchesRequired(required: PhaseEvent, written: PhaseEvent, card: RunCard): boolean {
  if (phaseForEvent(written) !== phaseForEvent(required)) {
    return false;
  }

  const requiredTaskId = taskIdForEvent(required);
  const writtenTaskId = taskIdForEvent(written);

  if (requiredTaskId !== null) {
    return writtenTaskId === requiredTaskId;
  }

  if (card.kind === 'task' && writtenTaskId !== null) {
    return writtenTaskId === card.id;
  }

  return true;
}

function approvalInterventionMatchesRequired(required: PhaseEvent, approved: PhaseEvent, card: RunCard): boolean {
  const phase = phaseForEvent(required);

  if (phase === null || phaseForEvent(approved) !== phase) {
    return false;
  }

  if (stringField(approved, 'code') !== `operator_approved_${phase}`) {
    return false;
  }

  return isTaskCardEventMatch(approved, card);
}

function isResolvedGate(required: PhaseEvent, eventsAfterRequired: readonly PhaseEvent[], card: RunCard): boolean {
  return eventsAfterRequired.some((event) => {
    if (isGateWritten(event)) {
      return gateWrittenMatchesRequired(required, event, card);
    }

    if (event.type === 'intervention') {
      return approvalInterventionMatchesRequired(required, event, card);
    }

    return false;
  });
}

function hypothesisCount(events: readonly PhaseEvent[], phase: Phase): number {
  return events.filter((event) => event.type === 'hypothesis_added' && phaseForEvent(event) === phase).length;
}

function hypothesisCountPhrase(count: number): string {
  if (count === 1) {
    return '1 ranked hypothesis';
  }

  if (count > 1) {
    return `${count} ranked hypotheses`;
  }

  return 'ranked hypotheses';
}

function auditCitation(events: readonly PhaseEvent[], phase: Phase): string {
  for (const event of events) {
    if (event.type !== 'repo_context_searched' || phaseForEvent(event) !== phase) {
      continue;
    }

    const selectedPath = stringArrayField(event, 'selectedPaths')[0];

    if (selectedPath) {
      return selectedPath;
    }
  }

  return 'the relevant files';
}

function planTaskCountPhrase(events: readonly PhaseEvent[], card: RunCard): string {
  const subtitleCount = card.subtitle.match(/\b(\d+)\s+tasks?\b/i)?.[1];

  if (subtitleCount) {
    return `${subtitleCount} ${subtitleCount === '1' ? 'task' : 'tasks'}`;
  }

  const taskIds = new Set<string>();

  for (const event of events) {
    const taskId = taskIdForEvent(event);

    if (taskId) {
      taskIds.add(taskId);
    }
  }

  if (taskIds.size === 1) {
    return '1 task';
  }

  if (taskIds.size > 1) {
    return `${taskIds.size} tasks`;
  }

  return 'the planned tasks';
}

function artifactName(card: RunCard): string {
  return card.artifactPath.split('#')[0] || card.artifactPath;
}

function bodyParagraphsForGate(events: readonly PhaseEvent[], card: RunCard): readonly string[] {
  if (card.phase === 'audit') {
    return [
      `The AI finished its diagnosis. It traced the issue to ${auditCitation(events, card.phase)} and produced ${hypothesisCountPhrase(hypothesisCount(events, card.phase))}. Read AUDIT.md (Artifact tab), then approve or ask the AI to revise.`,
    ];
  }

  if (card.phase === 'plan') {
    return [
      `The AI drafted a plan with ${planTaskCountPhrase(events, card)}. Read PLAN.md (Artifact tab), then approve or ask for revisions.`,
    ];
  }

  return [
    `The AI reached the ${card.phase} gate${card.kind === 'task' ? ` for ${card.id}` : ''}. Read ${artifactName(card)} (Artifact tab), then approve or ask for revisions.`,
  ];
}

function whyShouldICareForGate(card: RunCard): string {
  if (card.phase === 'audit') {
    return 'Approving sends the audit to the planner, which will draft the fix as a step-by-step PLAN you can edit.';
  }

  if (card.phase === 'plan') {
    return "Approving lets the builder start implementing the planned tasks; you'll review the code change before it ships.";
  }

  if (card.phase === 'build') {
    return "Approving lets verification start for this task; you'll still review the evidence before it ships.";
  }

  if (card.phase === 'review') {
    return 'Approving accepts the review outcome and lets the run continue toward the next gate.';
  }

  return 'Approving lets the run continue while preserving this gate in the event log.';
}

function titleForGate(phase: Phase, taskId: string | null): string {
  return taskId ? `gate ${phase} · ${taskId}` : `gate ${phase}`;
}

function idForGate(phase: Phase, taskId: string | null): string {
  return taskId ? `gate-${phase}-${taskId}` : `gate-${phase}`;
}

function buildDecision(
  required: PhaseEvent,
  events: readonly PhaseEvent[],
  card: RunCard,
): Extract<Decision, { readonly kind: 'gate-approval' }> {
  const phase = phaseForEvent(required) ?? card.phase;
  const taskId = taskIdForEvent(required);

  return {
    kind: 'gate-approval',
    id: idForGate(phase, taskId),
    title: titleForGate(phase, taskId),
    status: isResolvedGate(required, events.slice(events.indexOf(required) + 1), card) ? 'resolved' : 'open',
    bodyParagraphs: bodyParagraphsForGate(events, card),
    primaryCtaLabel: `Approve ${phase} & continue`,
    secondaryCtaLabel: 'Ask for revisions',
    whyShouldICare: whyShouldICareForGate(card),
  };
}

function reviewEventMatchesCard(event: PhaseEvent, card: RunCard): boolean {
  if (event.type !== 'review_round_completed' || card.phase !== 'review') {
    return false;
  }

  if (card.kind !== 'task') {
    return true;
  }

  const taskId = taskIdForEvent(event);
  return taskId === null || taskId === card.id;
}

function normalizeReviewVerdict(event: PhaseEvent): 'ready' | 'fix-first' | 'debate-required' {
  const verdict = stringField(event, 'verdict');

  if (verdict === 'ready' || verdict === 'fix-first' || verdict === 'debate-required') {
    return verdict;
  }

  if (verdict === 'needs-revision') {
    return 'fix-first';
  }

  if (verdict === 'block') {
    return 'debate-required';
  }

  const score = numberField(event, 'score');

  if (score !== null && score >= 6) {
    return 'ready';
  }

  return 'fix-first';
}

function optionalEventSummary(event: PhaseEvent): string | null {
  return stringField(event, 'summary') ?? stringField(event, 'notes') ?? stringField(event, 'rationaleSummary');
}

function aiVerdictBodyParagraphs(event: PhaseEvent, verdict: 'ready' | 'fix-first' | 'debate-required'): readonly string[] {
  const summary = optionalEventSummary(event);
  const summaryParagraph = summary ? [summary] : [];

  if (verdict === 'ready') {
    return ['The reviewing AI agreed the audit is ready to ship as drafted.', ...summaryParagraph];
  }

  if (verdict === 'debate-required') {
    return ['The reviewing AI disagreed strongly; a debate round was triggered to resolve it.', ...summaryParagraph];
  }

  const findingsCount = numberField(event, 'findingsCount') ?? numberField(event, 'findingsRaised');
  const issuePhrase = findingsCount && findingsCount > 0 ? `${findingsCount} issues` : 'issues';

  return [
    `The reviewing AI flagged ${issuePhrase}; the system will fix them automatically before continuing.`,
    ...summaryParagraph,
  ];
}

function buildAiVerdictDecision(event: PhaseEvent): Extract<Decision, { readonly kind: 'ai-verdict' }> {
  const verdict = normalizeReviewVerdict(event);
  const taskId = taskIdForEvent(event);
  const round = numberField(event, 'round');
  const idParts = ['ai-verdict', taskId, round ? `round-${round}` : null, event.ts].filter(
    (part): part is string => typeof part === 'string',
  );

  return {
    kind: 'ai-verdict',
    id: idParts.join('-'),
    title: `Cross-family review · verdict: ${verdict}`,
    verdict,
    status: verdict === 'ready' ? 'resolved' : 'open',
    bodyParagraphs: aiVerdictBodyParagraphs(event, verdict),
  };
}

function debateEventMatchesCard(event: PhaseEvent, card: RunCard): boolean {
  if (event.type !== 'debate_resolved') {
    return false;
  }

  const phase = phaseForEvent(event);
  return (phase === null || phase === card.phase) && isTaskCardEventMatch(event, card);
}

function debateWinner(event: PhaseEvent): string {
  return (
    stringField(event, 'winner')
    ?? stringField(event, 'callerVerdict')
    ?? stringField(event, 'responseVerdict')
    ?? 'unknown'
  );
}

function debateArgumentsBody(event: PhaseEvent): readonly string[] | null {
  const value = eventRecord(event).arguments;

  if (!Array.isArray(value)) {
    return null;
  }

  const paragraphs = value
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }

      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const label = typeof record.option === 'string' ? record.option : typeof record.side === 'string' ? record.side : null;
        const text = typeof record.summary === 'string' ? record.summary : typeof record.argument === 'string' ? record.argument : null;

        if (label && text) {
          return `${label}: ${text}`;
        }

        return text;
      }

      return null;
    })
    .filter((paragraph): paragraph is string => typeof paragraph === 'string' && paragraph.length > 0);

  return paragraphs.length > 0 ? paragraphs : null;
}

function debateBodyParagraphs(event: PhaseEvent): readonly string[] {
  const argumentsBody = debateArgumentsBody(event);

  if (argumentsBody) {
    return argumentsBody;
  }

  const rationaleSummary = stringField(event, 'rationaleSummary');

  if (rationaleSummary) {
    return [`The AI debate concluded; the system applied the winning option. ${rationaleSummary}`];
  }

  return ['The AI debate concluded; the system applied the winning option.'];
}

function buildDebateOutcomeDecision(event: PhaseEvent): Extract<Decision, { readonly kind: 'debate-outcome' }> {
  const topic = stringField(event, 'topic');

  return {
    kind: 'debate-outcome',
    id: ['debate-outcome', topic, event.ts].filter((part): part is string => typeof part === 'string').join('-'),
    title: `AI debate · winner: ${debateWinner(event)}`,
    status: 'resolved',
    bodyParagraphs: debateBodyParagraphs(event),
  };
}

function questionEventMatchesCard(event: PhaseEvent, card: RunCard): boolean {
  return event.type === 'question_added' && phaseForEvent(event) === card.phase;
}

function questionResolvedEventsFor(question: PhaseEvent, events: readonly PhaseEvent[]): readonly PhaseEvent[] {
  const questionId = stringField(question, 'id');

  if (!questionId) {
    return [];
  }

  return events.filter((event) => event.type === 'question_resolved' && stringField(event, 'id') === questionId);
}

function isOverdueQuestion(event: PhaseEvent, status: 'open' | 'resolved'): boolean {
  const dueBy = stringField(event, 'dueBy');

  if (!dueBy || status !== 'open') {
    return false;
  }

  const dueAt = new Date(dueBy);

  if (Number.isNaN(dueAt.getTime())) {
    return false;
  }

  return dueAt.getTime() < Date.now();
}

function formatDueBy(dueBy: string | null): string {
  if (!dueBy) {
    return 'No deadline set.';
  }

  const date = new Date(dueBy);

  if (Number.isNaN(date.getTime())) {
    return `Due by ${dueBy}`;
  }

  return `Due by ${date.toISOString().slice(0, 10)}`;
}

function buildOpenQuestionDecision(
  event: PhaseEvent,
  events: readonly PhaseEvent[],
): Extract<Decision, { readonly kind: 'open-question' }> {
  const questionId = stringField(event, 'id') ?? 'unknown';
  const status = questionResolvedEventsFor(event, events).length > 0 ? 'resolved' : 'open';
  const text = stringField(event, 'text');

  return {
    kind: 'open-question',
    id: `oq-${questionId}`,
    title: `Open question · ${questionId}`,
    status,
    overdue: isOverdueQuestion(event, status),
    bodyParagraphs: [
      text ?? `The AI flagged an open question (${questionId}) it could not resolve from the repository alone. Answer below or skip.`,
      formatDueBy(stringField(event, 'dueBy')),
    ],
  };
}

function budgetWarningMatchesCard(event: PhaseEvent, card: RunCard): boolean {
  if (event.type !== 'budget_warning') {
    return false;
  }

  const taskId = taskIdForEvent(event);

  if (taskId !== null) {
    return card.kind === 'task' && taskId === card.id;
  }

  return phaseForEvent(event) === card.phase;
}

function budgetRatio(event: PhaseEvent): number {
  const ratio = numberField(event, 'currentRatio') ?? numberField(event, 'ratio') ?? 0;
  return Math.max(0, Math.min(1, ratio));
}

function isResolvedBudgetWarning(event: PhaseEvent, events: readonly PhaseEvent[], card: RunCard): boolean {
  const eventIndex = events.indexOf(event);

  if (eventIndex < 0) {
    return false;
  }

  const taskId = taskIdForEvent(event);
  const phase = phaseForEvent(event);

  return events.slice(eventIndex + 1).some((laterEvent) => {
    if (laterEvent.type !== 'budget_warning') {
      return false;
    }

    if (taskId !== null && taskIdForEvent(laterEvent) !== taskId) {
      return false;
    }

    if (taskId === null && phaseForEvent(laterEvent) !== phase) {
      return false;
    }

    return budgetWarningMatchesCard(laterEvent, card) && budgetRatio(laterEvent) < budgetRatio(event);
  });
}

function budgetWarningBodyParagraph(event: PhaseEvent, ratio: number): string {
  const percent = Math.round(ratio * 100);
  const cap = numberField(event, 'cap') ?? numberField(event, 'limit');
  const currentSpend = numberField(event, 'currentSpend') ?? numberField(event, 'spent') ?? numberField(event, 'current');
  const unit = stringField(event, 'unit') ?? stringField(event, 'metric') ?? 'budget';

  if (cap !== null && currentSpend !== null) {
    return `Cost is at ${percent}% of the configured ${unit} budget (${currentSpend} of ${cap}). The AI will pause if it crosses 100%.`;
  }

  return `Cost is at ${percent}% of the configured budget for this phase. The AI will pause if it crosses 100%.`;
}

function buildBudgetWarningDecision(
  event: PhaseEvent,
  events: readonly PhaseEvent[],
  card: RunCard,
): Extract<Decision, { readonly kind: 'budget-warning' }> {
  const ratio = budgetRatio(event);
  const percent = Math.round(ratio * 100);

  return {
    kind: 'budget-warning',
    id: `bw-${event.ts}`,
    title: `Budget alert · ${percent}%`,
    status: isResolvedBudgetWarning(event, events, card) ? 'resolved' : 'open',
    ratio,
    bodyParagraphs: [budgetWarningBodyParagraph(event, ratio)],
  };
}

function projectDecisions(events: readonly PhaseEvent[], card: RunCard): Decision[] {
  const gateRequirements = events.filter((event) => isGateRequired(event) && gateMatchesCard(event, card));
  const gateDecisions = gateRequirements.map((event) => buildDecision(event, events, card));
  const aiVerdictDecisions = events.filter((event) => reviewEventMatchesCard(event, card)).map(buildAiVerdictDecision);
  const debateOutcomeDecisions = events.filter((event) => debateEventMatchesCard(event, card)).map(buildDebateOutcomeDecision);
  const openQuestionDecisions = events
    .filter((event) => questionEventMatchesCard(event, card))
    .map((event) => buildOpenQuestionDecision(event, events));
  const budgetWarningDecisions = events
    .filter((event) => budgetWarningMatchesCard(event, card))
    .map((event) => buildBudgetWarningDecision(event, events, card));

  return [
    ...gateDecisions.filter((decision) => decision.status === 'open'),
    ...openQuestionDecisions.filter((decision) => decision.status === 'open' && decision.overdue),
    ...aiVerdictDecisions.filter((decision) => decision.status === 'open'),
    ...budgetWarningDecisions.filter((decision) => decision.status === 'open'),
    ...openQuestionDecisions.filter((decision) => decision.status === 'open' && !decision.overdue),
    ...aiVerdictDecisions.filter((decision) => decision.status === 'resolved').reverse(),
    ...debateOutcomeDecisions.reverse(),
    ...gateDecisions.filter((decision) => decision.status === 'resolved').reverse(),
    ...budgetWarningDecisions.filter((decision) => decision.status === 'resolved').reverse(),
    ...openQuestionDecisions.filter((decision) => decision.status === 'resolved').reverse(),
  ];
}

function verdictColor(verdict: 'ready' | 'fix-first' | 'debate-required'): string {
  if (verdict === 'ready') {
    return 'text-emerald-300';
  }

  if (verdict === 'fix-first') {
    return 'text-amber-300';
  }

  return 'text-red-300';
}

async function postDecisionAction(runId: string, payload: DecisionActionPayload): Promise<void> {
  const response = await fetch(`/api/run/${runId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('Decision submit failed.');
  }
}

function taskIdForCard(card: RunCard): string | undefined {
  return card.kind === 'task' ? card.id : undefined;
}

function GateApprovalDecisionRow({
  runId,
  card,
  decision,
}: {
  readonly runId: string;
  readonly card: RunCard;
  readonly decision: Extract<Decision, { readonly kind: 'gate-approval' }>;
}) {
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const isOpen = decision.status === 'open';
  const isSubmitting = submitState === 'submitting';
  const isLocked = isSubmitting || submitState === 'ok';
  const trimmedFeedback = feedback.trim();

  const submit = async (payload: DecisionActionPayload) => {
    setSubmitState('submitting');

    try {
      await postDecisionAction(runId, payload);
      setSubmitState('ok');
    } catch {
      setSubmitState('error');
    }
  };

  const handleApprove = () => {
    void submit({
      runId,
      phase: card.phase,
      taskId: taskIdForCard(card),
      action: 'approve',
    });
  };

  const handleRevise = () => {
    void submit({
      runId,
      phase: card.phase,
      taskId: taskIdForCard(card),
      action: 'revise',
      feedback: trimmedFeedback,
    });
  };

  return (
    <article
      className={cn(
        isOpen
          ? 'border border-emerald-500/30 bg-emerald-500/[0.04] p-6 emerald-glow'
          : 'opacity-50 border border-white/10 bg-transparent p-6',
      )}
    >
      <div
        className={cn(
          'mb-3 text-[10px] font-bold uppercase tracking-[0.2em]',
          isOpen ? 'text-emerald-300' : 'text-white/40',
        )}
      >
        DECISION · {decision.title} · {isOpen ? 'YOUR APPROVAL NEEDED' : 'APPROVED'}
      </div>

      <div className="space-y-3 text-sm leading-relaxed text-white/80">
        {decision.bodyParagraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      {isOpen ? (
        <div className="flex flex-col">
          <button
            type="button"
            onClick={handleApprove}
            disabled={isLocked}
            className={cn('mt-5', EMERALD_BUTTON_CLASS)}
          >
            {isSubmitting && !revisionOpen ? 'Submitting...' : decision.primaryCtaLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              setRevisionOpen(true);
              setSubmitState('idle');
            }}
            disabled={isLocked}
            className="mt-3 w-full border border-white/15 px-5 py-2.5 text-white/70 transition-colors hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {decision.secondaryCtaLabel}
          </button>

          {revisionOpen ? (
            <div>
              <textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                disabled={isLocked}
                placeholder="What should the AI revise? Be specific."
                className={cn('mt-4 min-h-[80px]', TEXTAREA_CLASS)}
              />
              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleRevise}
                  disabled={isLocked || trimmedFeedback.length === 0}
                  className={cn('max-w-[180px]', EMERALD_BUTTON_CLASS)}
                >
                  {isSubmitting ? 'Sending...' : 'Send to AI'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRevisionOpen(false);
                    setFeedback('');
                    setSubmitState('idle');
                  }}
                  disabled={isSubmitting}
                  className={TEXT_BUTTON_CLASS}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {submitState === 'error' ? <p className="mt-3 text-xs text-red-300">Submit failed — try again.</p> : null}
        </div>
      ) : null}

      <p className="mt-5 border-t border-white/[0.06] pt-4 text-[11px] leading-relaxed text-white/40">
        <strong className="font-bold text-white/50">Why I should care: </strong>
        {decision.whyShouldICare}
      </p>
    </article>
  );
}

function AiVerdictDecisionRow({ decision }: { readonly decision: Extract<Decision, { readonly kind: 'ai-verdict' }> }) {
  return (
    <article className="border border-white/[0.08] bg-white/[0.015] p-6">
      <div className={cn('mb-3 text-[10px] font-bold uppercase tracking-[0.2em]', verdictColor(decision.verdict))}>
        DECISION · CROSS-FAMILY REVIEW · {decision.verdict}
      </div>

      <div className="space-y-3 text-sm leading-relaxed text-white/75">
        {decision.bodyParagraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      {decision.status === 'open' ? (
        <p className="mt-4 text-[11px] italic text-white/40">Status: system is handling automatically.</p>
      ) : null}
    </article>
  );
}

function DebateOutcomeDecisionRow({ decision }: { readonly decision: Extract<Decision, { readonly kind: 'debate-outcome' }> }) {
  return (
    <article className="border border-white/[0.08] bg-white/[0.015] p-6 opacity-70">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
        DECISION · AI DEBATE · WINNER
      </div>

      <div className="space-y-3 text-sm leading-relaxed text-white/75">
        {decision.bodyParagraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </article>
  );
}

function OpenQuestionDecisionRow({
  runId,
  card,
  decision,
}: {
  readonly runId: string;
  readonly card: RunCard;
  readonly decision: Extract<Decision, { readonly kind: 'open-question' }>;
}) {
  const [answer, setAnswer] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const isOpen = decision.status === 'open';
  const isSubmitting = submitState === 'submitting';
  const isLocked = isSubmitting || submitState === 'ok';
  const trimmedAnswer = answer.trim();
  const questionId = decision.id.replace(/^oq-/, '');

  const submit = async (payload: DecisionActionPayload) => {
    setSubmitState('submitting');

    try {
      await postDecisionAction(runId, payload);
      setSubmitState('ok');
    } catch {
      setSubmitState('error');
    }
  };

  const sendAnswer = () => {
    void submit({
      runId,
      phase: card.phase,
      action: 'answer-question',
      questionId,
      answer: trimmedAnswer,
    });
  };

  const skipQuestion = () => {
    void submit({
      runId,
      phase: card.phase,
      action: 'skip-question',
      questionId,
    });
  };

  return (
    <article
      className={cn(
        decision.overdue
          ? 'border border-amber-400/40 bg-amber-400/[0.03] p-6'
          : 'border border-white/[0.08] bg-white/[0.015] p-6',
      )}
    >
      <div
        className={cn(
          'mb-3 text-[10px] font-bold uppercase tracking-[0.2em]',
          decision.overdue ? 'text-amber-300' : 'text-white/45',
        )}
      >
        DECISION · OPEN QUESTION · {decision.overdue ? 'OVERDUE' : 'AWAITING ANSWER'}
      </div>

      <div className="space-y-3 text-sm leading-relaxed text-white/75">
        {decision.bodyParagraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      {isOpen ? (
        <div>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            disabled={isLocked}
            placeholder="Your answer (optional, helps the AI proceed faster)"
            className={cn('mt-4 min-h-[60px]', TEXTAREA_CLASS)}
          />
          <div className="mt-3 flex items-center gap-4">
            <button
              type="button"
              onClick={sendAnswer}
              disabled={isLocked || trimmedAnswer.length === 0}
              className={cn('max-w-[180px]', EMERALD_BUTTON_CLASS)}
            >
              {isSubmitting ? 'Sending...' : 'Send answer'}
            </button>
            <button type="button" onClick={skipQuestion} disabled={isLocked} className={TEXT_BUTTON_CLASS}>
              Skip
            </button>
          </div>
          {submitState === 'error' ? <p className="mt-3 text-xs text-red-300">Submit failed — try again.</p> : null}
        </div>
      ) : null}
    </article>
  );
}

function BudgetWarningDecisionRow({ decision }: { readonly decision: Extract<Decision, { readonly kind: 'budget-warning' }> }) {
  const percent = Math.round(decision.ratio * 100);
  const barWidth = Math.min(100, percent);

  return (
    <article className="border border-amber-400/40 bg-amber-400/[0.03] p-6">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
        DECISION · BUDGET ALERT · {percent}%
      </div>

      <div className="space-y-3 text-sm leading-relaxed text-white/75">
        {decision.bodyParagraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-amber-400" style={{ width: `${barWidth}%` }} />
      </div>
    </article>
  );
}

function DecisionRow({ runId, card, decision }: { readonly runId: string; readonly card: RunCard; readonly decision: Decision }) {
  if (decision.kind === 'gate-approval') {
    return <GateApprovalDecisionRow runId={runId} card={card} decision={decision} />;
  }

  if (decision.kind === 'ai-verdict') {
    return <AiVerdictDecisionRow decision={decision} />;
  }

  if (decision.kind === 'debate-outcome') {
    return <DebateOutcomeDecisionRow decision={decision} />;
  }

  if (decision.kind === 'open-question') {
    return <OpenQuestionDecisionRow runId={runId} card={card} decision={decision} />;
  }

  return <BudgetWarningDecisionRow decision={decision} />;
}

export default function DecisionsView({ runId, card }: DecisionsViewProps) {
  const [events, setEvents] = useState<PhaseEvent[]>([]);

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

  const decisions = useMemo(() => projectDecisions(events, card), [events, card]);

  if (decisions.length === 0) {
    return <p className="text-sm italic text-white/30">No decisions for this card yet.</p>;
  }

  return (
    <div className="space-y-4">
      {decisions.map((decision) => (
        <DecisionRow key={decision.id} runId={runId} card={card} decision={decision} />
      ))}
    </div>
  );
}
