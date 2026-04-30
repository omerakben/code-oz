// Reference candidate-selection sketch — the kind of pattern PLAN would
// search for when authoring task T-002 (selector that returns N suggestions).
export interface Candidate {
  readonly name: string
  readonly score: number
}

export function topN(candidates: readonly Candidate[], n: number): readonly Candidate[] {
  return [...candidates].sort((a, b) => b.score - a.score).slice(0, n)
}
