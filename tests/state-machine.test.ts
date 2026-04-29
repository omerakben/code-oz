import { describe, test, expect } from 'bun:test'
import {
  initialPhase,
  nextPhase,
  previousPhase,
  isTerminalPhase,
  isPhaseInProfile,
  validateTransition,
} from '../src/state/machine.ts'
import { GREENFIELD_SEQUENCE, BROWNFIELD_SEQUENCE } from '../src/state/schemas.ts'

describe('initialPhase', () => {
  test('greenfield starts at define', () => {
    expect(initialPhase('greenfield')).toBe('define')
  })
  test('brownfield starts at audit', () => {
    expect(initialPhase('brownfield')).toBe('audit')
  })
})

describe('nextPhase', () => {
  test('walks the greenfield sequence to terminal', () => {
    expect(nextPhase('define', 'greenfield')).toBe('plan')
    expect(nextPhase('plan', 'greenfield')).toBe('build')
    expect(nextPhase('build', 'greenfield')).toBe('verify')
    expect(nextPhase('verify', 'greenfield')).toBe('review')
    expect(nextPhase('review', 'greenfield')).toBe('ship')
    expect(nextPhase('ship', 'greenfield')).toBeNull()
  })

  test('walks the brownfield sequence to terminal', () => {
    expect(nextPhase('audit', 'brownfield')).toBe('plan')
    expect(nextPhase('plan', 'brownfield')).toBe('build')
    expect(nextPhase('build', 'brownfield')).toBe('verify')
    expect(nextPhase('verify', 'brownfield')).toBe('review')
    expect(nextPhase('review', 'brownfield')).toBe('ship')
    expect(nextPhase('ship', 'brownfield')).toBeNull()
  })

  test('returns null when phase is not in profile sequence', () => {
    // audit is brownfield-only — illegal in greenfield
    expect(nextPhase('audit', 'greenfield')).toBeNull()
    // define is greenfield-only — illegal in brownfield
    expect(nextPhase('define', 'brownfield')).toBeNull()
  })
})

describe('previousPhase', () => {
  test('walks back through greenfield', () => {
    expect(previousPhase('define', 'greenfield')).toBeNull()
    expect(previousPhase('plan', 'greenfield')).toBe('define')
    expect(previousPhase('ship', 'greenfield')).toBe('review')
  })

  test('walks back through brownfield', () => {
    expect(previousPhase('audit', 'brownfield')).toBeNull()
    expect(previousPhase('plan', 'brownfield')).toBe('audit')
    expect(previousPhase('ship', 'brownfield')).toBe('review')
  })

  test('returns null when phase is not in profile sequence', () => {
    expect(previousPhase('audit', 'greenfield')).toBeNull()
    expect(previousPhase('define', 'brownfield')).toBeNull()
  })
})

describe('isTerminalPhase', () => {
  test('ship is terminal in both profiles', () => {
    expect(isTerminalPhase('ship', 'greenfield')).toBe(true)
    expect(isTerminalPhase('ship', 'brownfield')).toBe(true)
  })

  test('non-terminal phases return false', () => {
    expect(isTerminalPhase('define', 'greenfield')).toBe(false)
    expect(isTerminalPhase('audit', 'brownfield')).toBe(false)
    expect(isTerminalPhase('review', 'greenfield')).toBe(false)
  })

  test('out-of-profile phases are not terminal', () => {
    expect(isTerminalPhase('audit', 'greenfield')).toBe(false)
    expect(isTerminalPhase('define', 'brownfield')).toBe(false)
  })
})

describe('isPhaseInProfile', () => {
  test('greenfield includes only define-through-ship', () => {
    for (const p of GREENFIELD_SEQUENCE) {
      expect(isPhaseInProfile(p, 'greenfield')).toBe(true)
    }
    expect(isPhaseInProfile('audit', 'greenfield')).toBe(false)
  })

  test('brownfield includes only audit-through-ship', () => {
    for (const p of BROWNFIELD_SEQUENCE) {
      expect(isPhaseInProfile(p, 'brownfield')).toBe(true)
    }
    expect(isPhaseInProfile('define', 'brownfield')).toBe(false)
  })
})

describe('validateTransition', () => {
  test('legal one-step transitions return null', () => {
    expect(validateTransition('define', 'plan', 'greenfield')).toBeNull()
    expect(validateTransition('audit', 'plan', 'brownfield')).toBeNull()
    expect(validateTransition('review', 'ship', 'greenfield')).toBeNull()
  })

  test('rejects skipping a phase', () => {
    expect(validateTransition('define', 'build', 'greenfield')).toBe('phase_skip')
    expect(validateTransition('audit', 'build', 'brownfield')).toBe('phase_skip')
    expect(validateTransition('plan', 'review', 'greenfield')).toBe('phase_skip')
  })

  test('rejects backwards transitions', () => {
    expect(validateTransition('plan', 'define', 'greenfield')).toBe('phase_backwards')
    expect(validateTransition('build', 'plan', 'brownfield')).toBe('phase_backwards')
  })

  test('rejects same-phase transitions as backwards', () => {
    expect(validateTransition('plan', 'plan', 'greenfield')).toBe('phase_backwards')
  })

  test('rejects transitions out of the terminal phase', () => {
    expect(validateTransition('ship', 'define', 'greenfield')).toBe('phase_terminal')
    expect(validateTransition('ship', 'plan', 'brownfield')).toBe('phase_terminal')
  })

  test('rejects phases not in the profile sequence', () => {
    // audit is brownfield-only
    expect(validateTransition('audit', 'plan', 'greenfield')).toBe('phase_not_in_profile')
    expect(validateTransition('define', 'audit', 'greenfield')).toBe('phase_not_in_profile')
    // define is greenfield-only
    expect(validateTransition('define', 'plan', 'brownfield')).toBe('phase_not_in_profile')
  })
})
