export async function doctorCommand(_args: string[]): Promise<void> {
  process.stderr.write(
    `code-oz doctor is not implemented in v0.1-alpha.0 (M1 — CLI bootstrap).
Provider auth checks and environment diagnostics arrive in M4.
See docs/design/ROADMAP.md for the milestone plan.
`,
  )
  process.exit(2)
}
