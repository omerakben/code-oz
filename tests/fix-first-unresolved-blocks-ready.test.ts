// M9 commit 1 substrate: REVIEW.md locks the stricter `fix-first` rule.
//
// The original draft of REVIEW.md carried a contradiction (Codex
// CODEX_RESPONSE_M9.md decision 3 catch):
//   - Severity table: "fix-first ... does not block exit"
//   - Findings grammar exit rule: "An exit with `Final verdict: ready`
//     and any `block` or `fix-first` finding still `unresolved` fails"
//
// The exit rule wins. M9 commit 1 makes the severity table consistent
// with the exit rule. M9 commit 4 (REVIEW.md parser) and commit 7
// (REVIEW orchestrator) consume this locked rule when computing the
// canonical Final verdict.

import { describe, test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const REVIEW_MD_PATH = join(import.meta.dir, '..', 'docs', 'contracts', 'REVIEW.md')

describe('REVIEW.md — fix-first unresolved blocks ready (M9 commit 1)', () => {
  test('severity table marks fix-first as a blocker for ready exit', async () => {
    const text = await readFile(REVIEW_MD_PATH, 'utf8')
    // The severity bullet must say "fix-first — must clear before the loop
    // can exit `ready`." (or equivalent locked language). The old
    // "does not block exit" wording is forbidden.
    expect(text).not.toMatch(/fix-first.*does not block exit/)
    expect(text).toMatch(/fix-first.*must clear before the loop can exit/)
  })

  test('findings grammar exit rule is unchanged (still names review_unresolved_blocker)', async () => {
    const text = await readFile(REVIEW_MD_PATH, 'utf8')
    expect(text).toMatch(
      /Final verdict: ready.*and any `block` or `fix-first` finding still `unresolved` fails with `review_unresolved_blocker`/s,
    )
  })

  test('decision-3 lock is documented inline (Codex catch attribution)', async () => {
    const text = await readFile(REVIEW_MD_PATH, 'utf8')
    // The lock must reference the contradiction Codex caught so future
    // contributors do not silently relax the rule. Tolerate Markdown
    // backticks around the filename.
    expect(text).toMatch(/CODEX_RESPONSE_M9\.md`?\s+decision 3/)
  })

  test('cap composition section locks two-monotonic-counters semantics (decision 4)', async () => {
    const text = await readFile(REVIEW_MD_PATH, 'utf8')
    expect(text).toMatch(/two monotonic global counters scoped to `\(runId, taskId\)`/)
    // The 4×4=16 misinterpretation must be explicitly rejected.
    expect(text).toMatch(/not a multiplicative budget/)
    // VERIFY-restart authority overlap is locked.
    expect(text).toMatch(/VERIFY restarts between REVIEW rounds do not increment REVIEW round count/)
  })
})
