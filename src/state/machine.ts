// Typed phase machine. Two fixed linear sequences (greenfield, brownfield) make
// this a transition table, not a state chart — no XState runtime weight.

import { type Phase, type Profile, sequenceFor } from './schemas.ts'

/**
 * Returns the initial phase for a profile (define for greenfield, audit for brownfield).
 */
export function initialPhase(profile: Profile): Phase {
  return sequenceFor(profile)[0]!
}

/**
 * Returns the phase that follows `current` in the given profile's sequence.
 * Returns null when `current` is terminal or is not in the profile's sequence.
 */
export function nextPhase(current: Phase, profile: Profile): Phase | null {
  const seq = sequenceFor(profile)
  const idx = seq.indexOf(current)
  if (idx === -1) return null
  if (idx === seq.length - 1) return null
  return seq[idx + 1] ?? null
}

/**
 * Returns the phase that precedes `current` in the given profile's sequence.
 * Returns null when `current` is the initial phase or not in the profile's sequence.
 */
export function previousPhase(current: Phase, profile: Profile): Phase | null {
  const seq = sequenceFor(profile)
  const idx = seq.indexOf(current)
  if (idx <= 0) return null
  return seq[idx - 1] ?? null
}

/**
 * Terminal phase = last entry in the profile's sequence (currently `ship` for both).
 */
export function isTerminalPhase(phase: Phase, profile: Profile): boolean {
  const seq = sequenceFor(profile)
  return seq[seq.length - 1] === phase
}

/**
 * True if `phase` participates in the given profile's sequence.
 * (e.g., `audit` is brownfield-only; `define` is greenfield-only.)
 */
export function isPhaseInProfile(phase: Phase, profile: Profile): boolean {
  return sequenceFor(profile).indexOf(phase) !== -1
}

/**
 * Why an attempted transition is illegal.
 * - phase_not_in_profile: from or to is not part of this profile's sequence
 * - phase_terminal: from is the terminal phase (no further transitions)
 * - phase_backwards: to comes before or equals from in the sequence
 * - phase_skip: to is more than one step ahead of from
 */
export type TransitionError =
  | 'phase_not_in_profile'
  | 'phase_terminal'
  | 'phase_backwards'
  | 'phase_skip'

/**
 * Validates `from -> to` against the profile's sequence. Returns null when
 * the transition is legal, or a typed error code otherwise.
 */
export function validateTransition(
  from: Phase,
  to: Phase,
  profile: Profile,
): TransitionError | null {
  const seq = sequenceFor(profile)
  const fromIdx = seq.indexOf(from)
  const toIdx = seq.indexOf(to)
  if (fromIdx === -1 || toIdx === -1) return 'phase_not_in_profile'
  if (fromIdx === seq.length - 1) return 'phase_terminal'
  if (toIdx <= fromIdx) return 'phase_backwards'
  if (toIdx > fromIdx + 1) return 'phase_skip'
  return null
}
