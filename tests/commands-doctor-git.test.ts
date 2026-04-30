import { describe, test, expect } from 'bun:test'
import {
  parseGitVersion,
  compareVersion,
  runDoctorGit,
  MIN_GIT_VERSION,
  doctorHelp,
} from '../src/commands/doctor.ts'

describe('parseGitVersion', () => {
  test('parses standard release: "git version 2.47.0"', () => {
    expect(parseGitVersion('git version 2.47.0')).toEqual([2, 47])
  })
  test('parses Windows variant: "git version 2.40.1.windows.1"', () => {
    expect(parseGitVersion('git version 2.40.1.windows.1')).toEqual([2, 40])
  })
  test('parses GIT-suffix variant: "git version 2.43.GIT"', () => {
    expect(parseGitVersion('git version 2.43.GIT')).toEqual([2, 43])
  })
  test('parses 2.40 minimum: "git version 2.40.0"', () => {
    expect(parseGitVersion('git version 2.40.0')).toEqual([2, 40])
  })
  test('returns null for non-git output', () => {
    expect(parseGitVersion('not git')).toBeNull()
    expect(parseGitVersion('')).toBeNull()
    expect(parseGitVersion('git')).toBeNull()
  })
  test('returns null for malformed version', () => {
    expect(parseGitVersion('git version foo.bar')).toBeNull()
    expect(parseGitVersion('git version 2.foo')).toBeNull()
  })
  test('handles leading/trailing whitespace via caller-side trim', () => {
    // parseGitVersion does NOT trim — caller responsibility
    expect(parseGitVersion('  git version 2.47.0  ')).toEqual([2, 47])
  })
})

describe('compareVersion', () => {
  test('equal versions return 0', () => {
    expect(compareVersion([2, 40], [2, 40])).toBe(0)
  })
  test('lower major returns negative', () => {
    expect(compareVersion([1, 99], [2, 0])).toBeLessThan(0)
  })
  test('higher major returns positive', () => {
    expect(compareVersion([3, 0], [2, 99])).toBeGreaterThan(0)
  })
  test('lower minor with same major returns negative', () => {
    expect(compareVersion([2, 39], [2, 40])).toBeLessThan(0)
  })
  test('higher minor with same major returns positive', () => {
    expect(compareVersion([2, 47], [2, 40])).toBeGreaterThan(0)
  })
})

describe('MIN_GIT_VERSION', () => {
  test('is 2.40 (per WORKTREE.md doctor check)', () => {
    expect(MIN_GIT_VERSION).toEqual([2, 40])
  })
})

describe('doctorHelp', () => {
  test('mentions the new git subcommand', () => {
    const help = doctorHelp()
    expect(help).toContain('git')
    expect(help).toContain('worktree')
  })
})

describe('runDoctorGit (live)', () => {
  // This test calls real `git --version` on the host. The repo's CI/dev
  // baseline is git >= 2.40 (we are using `git worktree` ourselves), so
  // happy-path coverage is sufficient here. Negative cases (missing git,
  // version too old) are exercised via parseGitVersion + compareVersion
  // unit tests above.
  test('reports git is available', async () => {
    const report = await runDoctorGit()
    expect(report.available).toBe(true)
    expect(report.versionRaw).toMatch(/^git version /)
    expect(report.version).toBeDefined()
    expect(report.version!.length).toBe(2)
  })

  test('reports meetsMinimum=true on dev baseline', async () => {
    const report = await runDoctorGit()
    expect(report.meetsMinimum).toBe(true)
    expect(report.exitCode).toBe(0)
  })
})
