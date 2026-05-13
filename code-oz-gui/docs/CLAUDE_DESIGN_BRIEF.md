# code-oz GUI — v0 design brief

> **Author:** Claude (driving) directing Codex (executing). Ozzy is offline.
> **Status:** locked source-of-truth. Codex executes against this; pushback on a section requires evidence + a written counter-proposal that Claude approves before code changes.
> **Source-of-truth artifacts in the CLI repo:** `~/Projects/code-oz/src/state/schemas.ts`, `~/Projects/code-oz/docs/design/SESSION_M17_KICKOFF.md`, `~/Projects/code-oz/CLAUDE.md`.

## 1. Mission

Build a **fully GUI-driven mode** for `code-oz` aimed at **a Business Analyst working with an existing repo** (brownfield). The BA opens a real codebase, describes what's broken in plain English, and walks an AI through the full SDLC (`AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP`) by reading what it produced and approving each gate. The GUI is the BA's window into a multi-agent run; the orchestrator runs in the CLI; the GUI never bypasses gates.

**Minimum input. Maximum SDLC quality.** That is the entire product promise. Every UI decision is judged against it.

## 2. Persona target

**Primary persona for v0: Business Analyst on a brownfield repo.**

- Comfortable reading prose, not code.
- Can identify a bug from end-user behavior ("the checkout fails on Safari iOS").
- Has read-only access to the repo (assumed via filesystem path).
- Does NOT know `git`, `grep`, the phase taxonomy by name, the gate-file mechanic, or what a "review round" is.
- Needs the GUI to teach the system through its surface — labels, microcopy, the AI helper.

PM, QA, Builder, and Lead are deferred to v0.x. Their projections are sketched in §13 for future-proofing only.

## 3. Architecture lock

```
┌─────────────────────────────────────────────────────────────────────┐
│ TOP BAR — persistent                                                │
│ [code OZ]  Workspace: /path/to/repo   Cost: $0.41/$5  [Settings]   │
├─────────────────────────────────────────────────────────────────────┤
│ COMPOSER — persistent                                               │
│ Describe what you want to fix, build, or understand...        [▶]   │
│ (focused → expands to multiline + repo-picker + start button)       │
├─────────────────────────────────────────────────────────────────────┤
│ BOARD — primary canvas                                              │
│                                                                     │
│ UNDERSTAND    PLAN        BUILD       VERIFY     REVIEW     SHIP    │
│ the problem   the work    the code    it works   for issues ready   │
│ ─────────     ─────       ─────       ──────     ────────   ─────   │
│ AUDIT         PLAN        4 tasks     2 of 4     1 of 4     —       │
│                                                                     │
│ [AUDIT card]  [PLAN card] [T-001]     [T-001]    [T-001]            │
│               4 tasks     [T-002]     [T-002]                       │
│                           [T-003]                                   │
│                           [T-004]                                   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ FOOTER — telemetry strip                                            │
│ Tokens 41% / 500k   Latency 12ms   Provider Claude Opus 4.7         │
└─────────────────────────────────────────────────────────────────────┘
```

Clicking any card opens the **right drawer** (slides over the canvas, ~520px wide). The board stays visible behind it (dimmed 30%).

```
                                            ┌──────────────────────────┐
                                            │ DRAWER — card detail     │
                                            │                          │
                                            │  T-001 — Add CSV export  │
                                            │  Currently in BUILD      │
                                            │                          │
                                            │  [Artifact] Events  Dec. │
                                            │  ────────                │
                                            │  BUILD_REPORT.md         │
                                            │  Patch: 3 files, +84/-12 │
                                            │  ...                     │
                                            │                          │
                                            │  ┌─────────────────────┐ │
                                            │  │ AI helper (corner)  │ │
                                            │  │ "What does this     │ │
                                            │  │  patch change?"     │ │
                                            │  └─────────────────────┘ │
                                            └──────────────────────────┘
```

## 4. Brand voice lock

**Keep one anchor.** The wordmark `CODE OZ` stays. The emerald accent stays. Oversized typography stays. Monochrome dark canvas stays.

**Kill everything else fantasy.** No "Forge", "Spellbook", "Magic Fix", "Whisper", "Cast", "Spell", "Mystical", "Realm", "Summon", "Brew", "Tin Man", "Scarecrow", "Lion". The product is an AI software company; the voice is professional with personality, not whimsical-fantasy.

### Vocabulary swap table (Codex MUST apply these one-for-one across the entire codebase, no exceptions)

| Seed term (KILL) | v0 term (USE) |
| --- | --- |
| Forge / The Oz Forge | Composer |
| Forge Command | Compose |
| Whisper a custom command action... | Describe what you want to fix, build, or understand... |
| Spellbook | Library |
| Spell / forged spell | Saved action |
| Magic Fix | Repair |
| Cast / Casting | Run |
| Wizard initiation | Initialize project |
| Mystical assistant / Master Blacksmith | (delete; AI helper is unnamed) |
| Initiate / Initiate the wizard | Initialize |
| Synchronize bridge / Sync the Realm | Sync workspace |
| Refactor detected bottlenecks / Bottleneck analysis | (delete fantasy verbs; just "Refactor: src/foo.ts:42-58") |
| 🔥 / 📜 / 🧠 / ⚡ emoji prefixes in logs | Removed. No emoji in console output. |
| "Heating up the Oz Forge..." | "Composing command..." |
| "Forge cooling down. Mystical error." | "Command composition failed: <reason>" |

Verbs are direct: **Open, Describe, Compose, Run, Approve, Pause, Re-run, Stop, View diff, View events, Open in editor.**

## 5. Visual language (locked)

**Type:**
- Wordmark: existing `text-[120px] font-black tracking-tighter` is approved.
- Page headers: `text-2xl font-bold tracking-tight`.
- Column headers: `text-xs uppercase tracking-[0.2em] font-bold text-white/50` (plain English) + `text-[10px] font-mono text-white/30` (technical name below).
- Body: `text-sm` for prose; `text-xs font-mono` for paths, IDs, file:line citations.

**Color (already in `globals.css`):**
- Background: `#050505` (canvas) / `#0a0a0a` (cards) / `#101010` (drawer).
- Foreground: `#ffffff` (primary), `white/70` (secondary), `white/40` (tertiary), `white/20` (quaternary).
- Single accent: `--brand: #10b981` (emerald). Use for: active phase pip, gate-approval CTA, "ready" decision badges, success state. **Never** for "in progress" — use white/40 with a slow pulse.
- Warning: `amber-400` for blocked / fix-first / budget warning.
- Error: `red-400` for verdict `block` / `verify_failed` / `worktree_failed`.

**Spacing:**
- Card padding: `p-6`.
- Drawer padding: `p-8`.
- Column gap: `gap-4`.
- Card vertical stack: `space-y-3`.

**Motion (deliberate, never flashy):**
- Card → column transition: 400ms ease-out with a subtle 4px y-shift.
- Drawer open: 240ms ease-out from right.
- Live event append: 120ms fade-in, no slide.
- Phase pip "ready" emerald shadow on gate: 700ms breathing pulse (`0_0_12px → 0_0_20px → 0_0_12px`), 2s cycle. The pulse is the *only* place ambient motion is allowed.

**Iconography:**
- Lucide only (`lucide-react`).
- One icon per surface action; no decorative icons.
- Phase column icons: `Search` (UNDERSTAND), `ListTodo` (PLAN), `Hammer` (BUILD), `CheckCircle2` (VERIFY), `ShieldCheck` (REVIEW), `Rocket` (SHIP). Sized `w-3.5 h-3.5`, color `white/30` until phase becomes active then `emerald-500/70`.

## 6. Component inventory

### 6.1 `<TopBar />` (existing header rebuilt)
Props: `repoPath: string | null`, `costSpent: number`, `costLimit: number`, `onOpenRepoClick: () => void`, `onSettingsClick: () => void`.

Renders:
- Left: small `code OZ` wordmark (`text-2xl font-black tracking-tighter`) + repo path (`text-xs font-mono text-white/40`, truncated middle).
- Right: cost gauge (token bar + dollar advisory, see §11) + settings cog.

### 6.2 `<Composer />` (replaces `<Forge />`)
Props: `value: string`, `disabled: boolean`, `onValueChange(v): void`, `onSubmit(v): void`, `repoPath: string | null`, `onOpenRepoClick(): void`.

States:
- **Empty + no repo open:** "Open a repo to start." (button label: **Open repo**). Composer input disabled.
- **Empty + repo open:** Placeholder: "Describe what you want to fix, build, or understand..." Compose button disabled until value present.
- **Has value:** Compose button enabled. Press Enter or click → submits.
- **Submitting:** Compose button label becomes "Composing…"; input disabled; emerald breathing pulse on input border (1.2s cycle).

Behavior:
- Input is single-line collapsed by default; on focus, smoothly grows to `min-h-[72px]`.
- Submit triggers `POST /api/run/start` (see §10) with `{ description, repoPath }`; expected response is `{ runId, profile }`. Profile is auto-detected by `code-oz` (greenfield vs brownfield).
- Show profile detection result inline below input for 4 seconds: "Detected: brownfield (existing repo with code)". White/60 text, no emoji.

### 6.3 `<Board />` (new — replaces the 4-up ActionCard grid)
Props: `phaseGroups: PhaseGroup[]`, `onCardClick(cardId): void`, `activeCardId: string | null`.

Layout: CSS grid, 6 columns equal width, `min-h-[500px]`, `overflow-x-auto` only when viewport < 1200px.

Each column renders:
- `<PhaseColumn />` with header + card stack.
- Empty column: faint dashed border `border-white/[0.03]`; centered placeholder text `text-xs text-white/15 italic` ("nothing here yet").
- Active phase column has emerald pip on header.

### 6.4 `<PhaseColumn />`
Props: `phaseId: 'audit' | 'plan' | 'build' | 'verify' | 'review' | 'ship'`, `plainTitle: string`, `subtitle: string`, `cards: Card[]`, `onCardClick(id): void`.

```
SEARCH icon  UNDERSTAND
             the problem
─────
AUDIT · ready for approval ●

[card] [card] ...
```

### 6.5 `<Card />` (new — supports both run-level and task-level cards)
Props: `kind: 'audit' | 'plan' | 'task'`, `title: string`, `subtitle: string`, `state: CardState`, `decisionsCount: number`, `onClick(): void`.

`CardState`:
```ts
type CardState =
  | { kind: 'pending' }
  | { kind: 'in-progress'; startedAt: string }
  | { kind: 'awaiting-approval'; gateName: string }
  | { kind: 'approved' }
  | { kind: 'failed'; reason: string }
  | { kind: 'blocked'; reason: string }
```

Visual rules:
- `awaiting-approval` is **the most visually loud state**: card border emerald-500/40, faint emerald glow, decision badge top-right "Needs you".
- `in-progress` is calm white/10 border + tiny moving-shimmer on the bottom edge (CSS animation, 2s).
- `approved` is muted; opacity 70%, no border accent.
- `failed` / `blocked` are amber/red border + sticky reason chip.

Card body content (≤ 4 lines, ellipsis allowed):
- Line 1: card title (`text-base font-bold tracking-tight`).
- Line 2: technical id + subtitle (`text-[11px] font-mono text-white/40`, e.g. `T-002 · src/payments/safari.ts`).
- Line 3: state descriptor (e.g. "Awaiting your approval", "Patch applied · running tests").
- Line 4: decisions count chip if > 0 ("3 decisions").

### 6.6 `<Drawer />` (new — slides over canvas)
Props: `cardId: string | null`, `onClose(): void`.

Layout:
- Width: `520px` on ≥ 1280px viewports; full-width on smaller.
- Backdrop: canvas dimmed `bg-black/50`, click to close.
- Sticky header: card title, kind chip, close icon.
- Tab bar: **Artifact** · Events · Decisions (Artifact default).
- Body: scrollable; tab content swaps with 180ms fade.
- Persistent **AI helper** at bottom-right of drawer (see §9), 240px × 280px collapsible card. Default state collapsed; one click opens.

### 6.7 `<ArtifactView />` (the **most important** new component)
Props: `artifactPath: string`, `artifactKind: 'audit' | 'spec' | 'plan' | 'build-report' | 'verify' | 'review' | 'ship'`.

Renders the markdown artifact with:
- Structural section nav on the left rail (`Localization`, `Reproduction`, `Constraints`, `Hypotheses`, …) — generated from the rendered markdown's `## H2` headings.
- Body: markdown rendered with `@tailwindcss/typography` `prose prose-invert` plus overrides for `code` (`bg-white/[0.04] px-1.5 py-0.5 rounded text-xs font-mono`), `pre` (`bg-black/40 p-4 rounded border border-white/5`), and `h2` (`text-base uppercase tracking-[0.2em] text-white/50 mt-8 mb-3 font-bold`).
- File:line citations like `src/payments/safari.ts:42-58` are auto-linkified to a "Open in editor" action (no-op stub in v0 logs the click; real impl deferred).
- Top-right: SHA-bound provenance chip ("audit_completed sha: a3f1…b219") — read from the corresponding `*_completed` event in events.jsonl. Hover shows full sha + timestamp.

### 6.8 `<EventsView />`
Props: `runId: string`, `cardId: string | null` (filter scope).

Renders a vertically scrolling list of events from the live SSE stream. Each row:
```
[14:32:08]  artifact_recorded  AUDIT.md  sha a3f1…b219
[14:32:09]  audit_completed   provider: claude-opus-4-7
[14:32:09]  gate_required     audit · BA approval pending
```

- Monospace, 12px.
- Filter chips at top: **All events** / Phase only / Errors only.
- Auto-scroll to newest event unless user scrolls up (then a "Jump to live" pill appears).
- Failed events (`*_failed`, `intervention`, `budget_warning`, `review_blocked`) get an amber/red left border accent.

### 6.9 `<DecisionsView />` (the load-bearing one)

Props: `runId: string`, `cardId: string`.

A vertical stack of **Decision rows**. Each row has the same shape regardless of source:
```
┌────────────────────────────────────────────────────────────────┐
│ DECISION · gate audit · YOUR APPROVAL NEEDED                   │
│ ────                                                            │
│ The AI finished its diagnosis of /path/to/repo. It traced the   │
│ Safari iOS bug to src/payments/safari.ts:42-58 and produced    │
│ 3 ranked hypotheses. Read AUDIT.md (left), then approve or     │
│ ask the AI to revise.                                          │
│                                                                 │
│ [  Approve audit & continue  ]  [ Ask for revisions ]          │
│                                                                 │
│ Why I should care: approving sends the audit to the planner    │
│ which will draft the fix as a step-by-step PLAN you can edit. │
└────────────────────────────────────────────────────────────────┘
```

Decision row kinds (all use the same shape):
1. **Gate approval (HUMAN required).** Visual loud (emerald border + pulse). Two CTAs: "Approve and continue" (primary) + "Ask for revisions" (secondary, opens textarea for feedback that becomes a `NEEDS_INTERVENTION.json` request).
2. **AI verdict (Codex review).** Calm. Read-only. Title format "Cross-family review · verdict: <push|fix-first|debate-required>". Body explains the verdict in BA-friendly terms ("The reviewing AI agreed the audit is ready" or "The reviewing AI flagged 3 issues; the system will fix them automatically before continuing"). Verdict color: push=emerald, fix-first=amber, block=red.
3. **Debate outcome (M15).** Calm. "AI debate · winner: <option>". Body summarizes the two positions in one paragraph each. Read-only.
4. **Open question (Scientist sidecar).** Amber border if overdue. "The AI is unsure about: <question>. Answer below or skip." Inline textarea + Skip button.
5. **Budget warning.** Amber. "Cost is at 76% of your $5 limit. Pause now or let it continue?"

**Vertical order:** most-actionable first (your-approval-needed, then overdue open questions, then AI verdicts pending, then resolved decisions in reverse-chronological order). Resolved decisions render with opacity 50%.

### 6.10 `<AIHelper />` (small persistent assistant)
Props: `runId: string`, `currentCardId: string | null`, `currentTab: 'artifact' | 'events' | 'decisions'`.

Floating card in the bottom-right of the drawer, collapsed by default to a 40px pill ("Ask"). On expand:
- Header: "Ask about this <audit | plan | task>"
- Suggested prompts (3, contextual to current tab):
  - On Artifact tab: "Explain this in plain English", "What changes if I approve?", "What's the riskiest hypothesis?"
  - On Decisions tab: "What happens if I approve?", "What if I ask for revisions?"
  - On Events tab: "Why did this fail?", "What did the AI do here?"
- Free text input + send button.

Backend (see §10): `POST /api/helper/ask` with `{ runId, cardId, currentTab, prompt }`. Returns `{ answer }`. Provider is **Google Gemini Flash** (`gemini-3-flash-preview` or current latest). Chosen for cross-family distribution: the CLI personas run on Anthropic (Claude), the cross-family REVIEW runs on OpenAI (gpt-5.5), the PE-1 integration runs on xAI (Grok), so the GUI helper deliberately uses a fourth family (Google) to avoid same-family bias when explaining the run to a non-developer. See user memory `project_provider_family_distribution`. System prompt: "You are a non-developer-friendly assistant explaining a code-oz run. Be concrete, cite file:line when relevant, never invent file paths, and respond in ≤ 4 sentences unless asked for detail."

The helper has **read-only access** to the run's events.jsonl + artifact files. Server reads them in the request handler and includes them in the prompt context. No tool calls; no web access; no provider switching by the user.

### 6.11 `<Sidebar />` (rewrite of existing)

Drop: Spellbook, Intelligence/AI-Suggest/Optimize/Auto-Docs (those features survive only if needed in v0.x).

Keep + simplify:
- **Workspace** — current repo path + small "switch" link.
- **Run history** — list of past runs in this workspace (3 most recent). Each row: `audit · 2 days ago · shipped` or `plan · paused · resume`. Click resumes the run in the board.
- **Library** — saved actions (renamed from Spellbook). Empty in v0; sketched only.

Total sidebar height should be **shorter than v0 seed** (the seed crams too much). Aim for `space-y-12` between 2 sections, nothing more.

## 7. Phase column headers (exact strings — Codex DOES NOT alter)

| Column | Plain title | Subtitle | Tech name |
| --- | --- | --- | --- |
| 1 | UNDERSTAND | the problem | AUDIT |
| 2 | PLAN | the work | PLAN |
| 3 | BUILD | the code | BUILD |
| 4 | VERIFY | it works | VERIFY |
| 5 | REVIEW | for issues | REVIEW |
| 6 | SHIP | ready | SHIP |

Tech name renders below subtitle as `text-[10px] font-mono uppercase tracking-[0.2em] text-white/25`.

For greenfield runs (future), column 1's plain title becomes `DEFINE / the goal / DEFINE`. Profile switches the header strings.

## 8. Card grain rule (v0 lock)

- **AUDIT** column: exactly 1 card — the run's AUDIT artifact card.
- **PLAN** column: exactly 1 card — the run's PLAN artifact card (lists task count inside).
- **BUILD** column: N cards, one per PLAN task (T-001, T-002, …). Tasks fan out per `parentTaskId` (byterover-cli borrow) — sub-tasks render as nested indented cards.
- **VERIFY** column: N cards mirroring BUILD's, advancing as each task passes verify.
- **REVIEW** column: N cards mirroring VERIFY's, plus per-task `review_round_completed` chip count.
- **SHIP** column: 1 card per run (the SHIP artifact).

When a task moves to a new column, the card smoothly transitions across (not a respawn). Use a layout-animation library (`motion/react` is already a dep) with `layoutId={taskId}`.

## 9. AI helper context grounding (anti-hallucination)

The helper is the single biggest hallucination risk. Hard rules Codex must wire into `POST /api/helper/ask`:

1. **Always include the full artifact text** of the currently-viewed card (≤ 8k tokens; truncate from middle if larger).
2. **Always include the last 50 events** from events.jsonl, formatted as `[ts] type details`.
3. **Always include the run's profile** (greenfield/brownfield) and the current phase.
4. **System prompt forbids:**
   - Inventing file paths not present in the artifact or events.
   - Suggesting commands the BA should run in a terminal.
   - Asking the BA to read code.
   - Recommending approve/reject — only explain consequences.
5. **Response cap: 4 sentences** unless the BA's prompt explicitly asks for more.
6. **Citations:** when referencing a file, the helper writes `src/foo.ts:42-58` exactly as it appears in the artifact, no paraphrasing.

## 10. Bridge architecture (server-side Next.js)

Bridge = Next.js server reading the local filesystem + spawning the `code-oz` CLI binary. Browser never touches the filesystem directly.

### 10.1 Routes (App Router, `app/api/`)

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/workspace/open` | POST | Body `{ path }`. Validates the path exists; stores in a server-side session cookie (single-user v0). Returns `{ ok, profile, hasRuns }`. |
| `/api/run/start` | POST | Body `{ description, repoPath }`. Spawns `code-oz run --request "<description>" --provider fake-or-claude` as a detached subprocess. Returns `{ runId }` immediately; the subprocess writes events.jsonl and artifacts. |
| `/api/run/:runId/state` | GET | Returns the latest projection of run state (currentPhase, profile, cards array). Built by replaying events.jsonl up to now. Used on first drawer open and after reconnect. |
| `/api/run/:runId/events` | GET (SSE) | Long-lived Server-Sent-Events stream. Server uses `fs.watch` on `events.jsonl` and pushes each new line as `event: append` data `{ event }`. Initial reply sends a snapshot of all existing events. |
| `/api/run/:runId/artifact/:name` | GET | Returns markdown text for AUDIT.md / PLAN.md / etc. Reads from `.code-oz/artifacts/<name>` or `.code-oz/state/runs/<runId>/<name>`. Sha-binds against the corresponding `*_completed` event. |
| `/api/run/:runId/approve` | POST | Body `{ phase, decision: 'approve' | 'revise', revisionNotes? }`. On `approve`, server spawns `code-oz approve <phase> --run <runId>`. On `revise`, server writes a `requests/<request-id>.json` advisory request file at `.code-oz/state/runs/<runId>/requests/` per CLAUDE.md rule 1. |
| `/api/helper/ask` | POST | Body `{ runId, cardId, currentTab, prompt }`. Calls Google Gemini Flash with the context-grounding rules in §9. Returns `{ answer }`. |

### 10.2 Filesystem layout (read-only by GUI)

```
<repoPath>/.code-oz/
  state/runs/<runId>/
    events.jsonl                ← fs.watch target, append-only
    current.json                ← projection (cards, currentPhase, profile)
    requests/<request-id>.json  ← advisory requests written by GUI
  artifacts/<runId>/            ← if runtime puts artifacts per-run
    AUDIT.md
    PLAN.md
    BUILD_REPORT.md
    ...
```

If the runtime stores artifacts at a different path, Codex must consult `~/Projects/code-oz/src/state/run.ts` for the truth (do not invent paths).

### 10.3 Process model

- One Next.js server process.
- One detached `code-oz` subprocess per active run; PID stored in server memory keyed by runId.
- `fs.watch` handle per SSE subscriber, debounced 50ms.
- On Next.js dev reload, kill subprocesses on `process.on('SIGTERM')`.

### 10.4 Auth

**None in v0.** Server-only, localhost-only, single-user. Bind to `127.0.0.1` only. Document this in the README; banner the UI top-bar with `Local only · single user`.

## 11. Cost surfacing (rule 19 compliance)

Top-bar gauge:
```
[████████░░░░░░░░░░░░░░░░] 41% · 205k / 500k tokens
$0.41 advisory
```

- Bar fills with white/70 until 75% then turns amber, then red at 95%.
- Token limit is the run's `budgets.global.maxTokensEstimate`; default 500k.
- Dollar advisory uses the run's `priceTable` (read from `events.jsonl` `config_resolved` event).
- Hover shows: per-role cost rollup, current effort envelope, soft-warn threshold.

In the drawer, each task card shows its own cost roll-up (parent + children, per byterover-cli borrow B6).

## 12. Empty / loading / error states

Every component MUST handle:

| State | Treatment |
| --- | --- |
| No workspace open | Big centered card: "Open a repo to start" + Open repo button. Hide board entirely. |
| Workspace open, no runs yet | Show empty board with all 6 columns dashed. Centered text above board: "Describe what you want to fix, build, or understand in the bar above." |
| Run starting | Composer shows breathing pulse; board's UNDERSTAND column shows pending shimmer card. |
| Event stream connecting | Tiny top-bar pill: "Connecting…" `text-xs text-white/30`. Disappears on first event received. |
| Event stream disconnected | Amber top-bar pill: "Reconnecting…" + auto-retry every 2s. |
| Artifact not yet produced | Card body: italic `text-white/30` "The AI is still working on this." No spinner. |
| Artifact failed to parse | Red card border + chip "Couldn't parse this artifact" + link to raw text view. |
| Helper API error | Inline italic `text-white/40` "The helper is unavailable right now. Read the artifact directly." |

## 13. Future-proofing (do not build in v0, but design must not preclude)

- **PM persona view:** higher-level board where each card is a *run* (Option B from the question list). Codex must keep the `<Board />` component generic so a "Project Board" mode can re-use it with `kind: 'project'` cards.
- **QA persona view:** filtered drawer that defaults to VERIFY/REVIEW tabs and surfaces a "Re-run verify" CTA. Just keep the Drawer's tab system pluggable.
- **Multi-run dashboard:** v0 already plumbs run history in the sidebar; this is the seed of multi-run.
- **AUDIT replay / time travel:** events.jsonl is the substrate. A `<Timeline />` component would replay state at any timestamp. Don't build, but keep the event projection pure (state derived solely from events, no side state).
- **Cross-family debate visual:** when an `intervention` or `review_blocked` event fires with a `debate_*` follow-up, the Decision row should expand into a side-by-side AI vs. AI summary. v0 renders as a single Decision row; v0.x renders as a split view.

## 14. Hard anti-patterns (Codex MUST not introduce)

1. **No `setTimeout` simulation** anywhere outside test fixtures. Every UI state must derive from real events. Mock data lives in `fixtures/sample-run/` only.
2. **No "fun" microcopy.** "Establishing magical bridge", "Forge cooling down", "Mystical error" — all banned. See §4 swap table.
3. **No global state in React Context** for run data. Use a single `useRunStream(runId)` hook backed by SSE; pass derived state down. Keep components pure.
4. **No tab-icon-only navigation.** Every icon has a text label visible at default state. Touch-target ≥ 32px.
5. **No emoji in production strings.** (BA users in enterprise contexts find emoji unprofessional.) Single exception: the small `●` phase pip is a Unicode bullet, not an emoji.
6. **No autoplay/autoplay-loop motion outside the phase-pip pulse.** No looping shimmers on idle cards. No animated SVGs in empty states.
7. **No client-side filesystem access.** All `fs.*` calls live in Next.js route handlers or server components.
8. **No mixing tailwind class strings in JSX with dynamic logic.** Use `clsx` + `tailwind-merge` (`cn()` already exists in `lib/utils.ts`).
9. **No "marketing" copy in the empty state.** No "Welcome to the future of SDLC!" lines. State what to do next, period.
10. **No alternate fonts.** System font stack + one mono. (Existing globals.css is fine.)

## 15. Definition of done for v0

A BA on a clean machine can:

1. Open the GUI (`bun run dev`).
2. Click **Open repo**, pick `/path/to/legacy-app`.
3. Type "The checkout fails on Safari iOS" in the Composer; click **Compose**.
4. See an AUDIT card appear in column 1 with a live "in progress" shimmer.
5. Watch real events stream in the drawer's Events tab as the AI works.
6. See the AUDIT card transition to "Awaiting your approval" (loud emerald state) with a Decisions tab showing "AI verdict: Ready · Your approval needed".
7. Click "Approve audit & continue".
8. See a PLAN card appear in column 2.
9. (And so on through SHIP — but v0 only needs to *render correctly* through the first 2 columns to count as done; columns 3–6 ship with the fixture run.)

The BA never reads code, never opens a terminal, never sees a stack trace. Errors are translated by the AI helper into BA-friendly prose.

## 16. Out of scope for v0

- Authentication / multi-user / sharing runs.
- Editing artifacts in the GUI (BAs read; the AI writes).
- Provider switching from the UI (config-only).
- Mobile / tablet layouts (desktop ≥ 1280px only).
- Dark/light mode toggle (dark only).
- Live brownfield smoke against external repos (use fixtures).
- Replacing the seed's `next.config.ts` build setup unless strictly necessary.
- Tests beyond a single Playwright happy-path smoke (Composer → Audit card appears).

## 17. Quality bar Codex is judged against

Claude (the reviewer) will critique on these axes after every Codex round. **Each axis is 0–5; v0 ships only when each axis is ≥ 4.**

| Axis | What 5 looks like |
| --- | --- |
| Vocabulary | Every fantasy term gone. Microcopy a BA would write. |
| Hierarchy | Board > Composer > Drawer > Helper. Eye lands on the correct surface first. |
| Decisions clarity | A BA who has never seen the product can find "what I need to do" within 5 seconds of opening the drawer. |
| Motion restraint | Only the phase pip and live-event append move ambiently. No flashy spinners, no bouncing CTAs. |
| Data fidelity | Every label/badge/chip traces to an event or artifact field. No invented values. |
| Empty states | All 7 from §12 implemented and tested with toggles or fixture swaps. |
| Accessibility | Tab order is logical, focus rings visible, Escape closes drawer, Enter submits composer. |
| Performance | First contentful paint < 1.0s on a 200-event run; SSE keeps up with 5 events/sec without blocking. |

## 18. Execution order for Codex (R0 commit sequence)

Codex executes these in order; one commit per step.

1. **Vocabulary sweep + brand voice lock.** Apply §4 swap table everywhere. Delete the seed's fantasy terms. Update `app/page.tsx`, `components/Sidebar.tsx`, `components/Forge.tsx` (becoming `Composer.tsx`), `components/Terminal.tsx`, `lib/oz-bridge.ts`. Verify no banned terms remain via grep.
2. **Fixture run.** Add `fixtures/sample-run/` with realistic `events.jsonl` (≥ 60 events covering run_started → phase_entered audit → repo_context_searched → persona_invocation_started/completed auditor → artifact_recorded AUDIT.md → audit_completed → gate_required audit → approve → phase_entered plan → … → phase_entered build with 4 tasks → 2 of 4 build_completed → 2 of 4 verify_completed → 1 of 4 review_round_completed), plus AUDIT.md, PLAN.md, partial BUILD_REPORT.md, partial VERIFY.md following the schemas in `~/Projects/code-oz/src/artifacts/*.ts`.
3. **Bridge API skeleton.** Implement all 7 routes from §10.1 backed by the fixture run (no real subprocess yet; spawning real `code-oz` deferred to step 9). SSE handler with `fs.watch` is essential — test it by manually appending to events.jsonl.
4. **Board + PhaseColumn + Card.** New components per §6.3–6.5 driven from `/api/run/<runId>/state`. Wire to fixture; show all 6 columns with cards in correct states. Card grain rule per §8.
5. **Drawer + Artifact tab.** `<Drawer />` slides over canvas; `<ArtifactView />` renders AUDIT.md from fixture with section nav, prose styling, citation linkification, provenance chip.
6. **Events tab.** `<EventsView />` consumes SSE; filters; auto-scroll; failed-event accents.
7. **Decisions tab.** `<DecisionsView />` renders gate-approval + AI verdict + open-question + budget-warning rows from fixture. Approve/Revise wiring to `/api/run/.../approve`.
8. **AI helper.** `<AIHelper />` with Gemini Flash calls. Server-side context grounding per §9. Suggested prompts per current tab.
9. **Real run spawn.** Replace fixture in `/api/run/start` with real `Bun.spawn(['code-oz', 'run', …])`. Validate against an actual `bun run dev run --provider fake` invocation in `~/Projects/code-oz`. If the fake provider doesn't write events.jsonl as expected, debug and document; don't bury the issue.
10. **Smoke + polish.** Single Playwright test for happy path. Pixel-pass per §17 quality bar. Codex stops here and hands back for Claude review.

## 19. Communication contract between Codex and Claude

After each commit in §18, Codex writes a brief commit message and waits for Claude's critique before continuing. Claude returns either:
- `proceed` — move to next step.
- `revise: <specific list>` — fix listed items first, then proceed.
- `escalate: <question>` — Claude reconsiders the brief, may amend.

Codex does not skip steps. Codex does not bundle steps unless Claude says "bundle 6+7" explicitly.

## 20. References (read before starting)

- `~/Projects/code-oz/CLAUDE.md` — the 23 non-negotiable rules. Rule 1 (file-based gates), rule 18 (repo_context permission scope), rule 19 (budget enforcement) are load-bearing for this GUI.
- `~/Projects/code-oz/src/state/schemas.ts` — `PHASES`, `EVENT_TYPES`, event shape definitions. **Authoritative source for event types.** Do not invent new event types.
- `~/Projects/code-oz/src/artifacts/*.ts` — artifact validators. Schema sources of truth for AUDIT/SPEC/PLAN/BUILD_REPORT/VERIFY/REVIEW.
- `~/Projects/code-oz/docs/design/SESSION_M17_KICKOFF.md` — M17 (AUDIT runtime) implementation plan. Shape of AUDIT.md sections + `audit_completed` event contract.
- `~/Projects/code-oz/docs/handoffs/2026-05-12-phase1-complete-m17-design-closed-gui-prep.md` — original GUI prep notes Claude consulted while writing this brief.
