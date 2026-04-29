export async function runCommand(_args: string[]): Promise<void> {
  process.stderr.write(
    `code-oz run is not implemented in v0.1-alpha.0 (M1 — CLI bootstrap).
Phase execution arrives in M5 (DEFINE) and the full spine completes in M7.
See docs/design/ROADMAP.md for the milestone plan.
`,
  )
  process.exit(2)
}
