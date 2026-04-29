// Atomic gate file I/O. Reads and writes the success and intervention gate
// files defined in docs/references/file-based-gates.md.
//
// Atomicity: writes go to a sibling temp file in the same directory, are
// fsynced, then renamed into place. The directory itself is fsynced after the
// rename (best-effort on platforms that don't support directory fsync). The
// per-run lock from src/state/lock.ts serializes concurrent writers.
//
// Idempotency: if a success gate already exists with identical content, the
// write is a no-op (used by cross-file recovery in run.ts). Different content
// at the same path produces gate_idempotency_violation.
//
// Path safety: artifact paths are validated relative, normalized, free of
// `..` segments, and resolved against the artifact root via realpath so
// symlink escapes are caught. See validation rule 7 in the pinned spec.
//
// This module ONLY validates and writes gate files. Event-log appends and
// FSM bookkeeping live in src/state/run.ts.

import { open, readFile, rename, rm, realpath, stat } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { isAbsolute, normalize, resolve, relative, join } from 'node:path'
import {
  type GateFile,
  type Phase,
  type NeedsInterventionGate,
  type PauseGate,
  type StopGate,
  PHASES,
  isUlid,
  isPhase,
  isIsoTimestamp,
} from './schemas.ts'
import { GateLoadError, type GateLoadIssue } from './errors.ts'
import { LockBusyError, withLock } from './lock.ts'

// --- public types --------------------------------------------------

export interface GatePaths {
  /** Absolute path to the run subdirectory (.code-oz/state/runs/<runId>/). */
  readonly runDir: string
  /** Absolute path to the artifact root (artifact paths are resolved against this). */
  readonly artifactRoot: string
  /** Absolute path to the per-run lock directory. */
  readonly lockDir: string
}

export interface WriteGateResult {
  /** Filename written, e.g. GATE_DEFINE_PASSED.json (relative to runDir). */
  readonly filename: string
  /** Sha256 recorded in the gate (when computed or supplied). */
  readonly artifactSha256?: string
  /** True when the gate file already existed with matching content (idempotent recovery). */
  readonly existed: boolean
}

export interface WriteGateOptions {
  readonly paths: GatePaths
  readonly gate: GateFile
  /** When true (default), compute and overwrite artifactSha256 from the artifact file. */
  readonly computeSha256?: boolean
}

// --- success gate (GATE_<PHASE>_PASSED.json) -----------------------

export function gateFilename(phase: Phase): string {
  return `GATE_${phase.toUpperCase()}_PASSED.json`
}

/**
 * Write a GATE_<PHASE>_PASSED.json file atomically (temp + rename + dir fsync).
 * Optionally computes artifactSha256 from the artifact contents and overwrites
 * the field on the gate object before serialization.
 *
 * Idempotent: if a gate file at the target path already contains JSON that
 * deep-equals the gate object after sha256 substitution, the write is skipped
 * and `existed: true` is returned. Different content produces
 * gate_idempotency_violation.
 *
 * Locks via the per-run mkdir-lock for the duration of the write; the lock is
 * released after the rename + dir fsync.
 */
export async function writeGate(opts: WriteGateOptions): Promise<WriteGateResult> {
  const filename = gateFilename(opts.gate.phase)
  const targetPath = join(opts.paths.runDir, filename)

  const validationIssue = validateGate(opts.gate, targetPath)
  if (validationIssue !== null) throw new GateLoadError([validationIssue])

  // Resolve artifact path safely and verify the file exists.
  const artifactAbs = await resolveArtifactPath(
    opts.gate.artifact,
    opts.paths.artifactRoot,
    targetPath,
    /* requireExist */ true,
  )

  let gateWithSha: GateFile = opts.gate
  if (opts.computeSha256 !== false) {
    const sha256 = await sha256File(artifactAbs)
    gateWithSha = { ...opts.gate, artifactSha256: sha256 }
  } else if (opts.gate.artifactSha256 !== undefined) {
    // Verify supplied hash matches the artifact contents.
    const actual = await sha256File(artifactAbs)
    if (actual !== opts.gate.artifactSha256) {
      throw new GateLoadError([
        {
          file: targetPath,
          code: 'gate_artifact_sha256_mismatch',
          rule: 'supplied artifactSha256 does not match the artifact contents',
          detail: `expected ${opts.gate.artifactSha256}, got ${actual}`,
        },
      ])
    }
  }

  // Idempotency: if the gate file already exists, deep-compare to detect
  // recovery vs. corruption.
  const existing = await tryReadGate(targetPath)
  if (existing !== null) {
    if (gatesEqual(existing, gateWithSha)) {
      return Object.freeze({
        filename,
        artifactSha256: gateWithSha.artifactSha256,
        existed: true,
      })
    }
    throw new GateLoadError([
      {
        file: targetPath,
        code: 'gate_idempotency_violation',
        rule: 'gate file exists with different content; redo a phase by starting a new runId',
      },
    ])
  }

  const json = JSON.stringify(gateWithSha, null, 2) + '\n'
  const buf = Buffer.from(json, 'utf8')

  try {
    await withLock(opts.paths.lockDir, async () => {
      const tmpPath = `${targetPath}.tmp-${randomBytes(6).toString('hex')}`
      const fh = await open(tmpPath, 'w')
      try {
        await fh.write(buf, 0, buf.length)
        await fh.sync()
      } finally {
        await fh.close()
      }
      try {
        await rename(tmpPath, targetPath)
      } catch (err: unknown) {
        await rm(tmpPath, { force: true }).catch(() => undefined)
        throw err
      }
      // Best-effort directory fsync. Errors here mean the platform doesn't
      // support fsync on a directory handle (e.g., some Windows filesystems).
      try {
        const dirfh = await open(opts.paths.runDir, 'r')
        try {
          await dirfh.sync()
        } finally {
          await dirfh.close()
        }
      } catch {
        // Best-effort: rename itself is durable on POSIX once the destination
        // file's fsync has succeeded; the dir-fsync only ensures the directory
        // entry survives a power loss. Skipped silently when unsupported.
      }
    })
  } catch (err: unknown) {
    if (err instanceof LockBusyError) {
      throw new GateLoadError([
        {
          file: targetPath,
          code: 'gate_lock_busy',
          rule: 'per-run lock is busy; another writer holds it',
          detail: err.lockDir,
        },
      ])
    }
    if (err instanceof GateLoadError) throw err
    throw new GateLoadError([
      {
        file: targetPath,
        code: 'gate_io_error',
        rule: 'failed to write gate file',
        detail: (err as Error).message,
      },
    ])
  }

  return Object.freeze({
    filename,
    artifactSha256: gateWithSha.artifactSha256,
    existed: false,
  })
}

/**
 * Read and validate a GATE_<PHASE>_PASSED.json file. Verifies schema, ULID
 * runId, ISO timestamps, artifact path safety, and (when artifactSha256 is
 * present) that the artifact's actual sha256 matches.
 *
 * The pinned spec keeps artifactSha256 optional on read (rule 5). When present
 * it MUST match; when absent the gate is accepted.
 */
export async function readGate(
  filePath: string,
  artifactRoot: string,
): Promise<GateFile> {
  let raw: unknown
  try {
    const content = await readFile(filePath, 'utf8')
    raw = JSON.parse(content)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new GateLoadError([
        {
          file: filePath,
          code: 'gate_io_error',
          rule: 'gate file not found',
          detail: filePath,
        },
      ])
    }
    if (err instanceof SyntaxError) {
      throw new GateLoadError([
        {
          file: filePath,
          code: 'gate_invalid_json',
          rule: 'gate file is not valid JSON',
          detail: err.message,
        },
      ])
    }
    throw new GateLoadError([
      {
        file: filePath,
        code: 'gate_io_error',
        rule: 'failed to read gate file',
        detail: (err as Error).message,
      },
    ])
  }

  const issue = validateGate(raw, filePath)
  if (issue !== null) throw new GateLoadError([issue])
  const gate = raw as GateFile

  // Resolve artifact path safely (and verify it exists; success gates always
  // reference a real artifact).
  const artifactAbs = await resolveArtifactPath(gate.artifact, artifactRoot, filePath, true)

  if (gate.artifactSha256 !== undefined) {
    const actual = await sha256File(artifactAbs)
    if (actual !== gate.artifactSha256) {
      throw new GateLoadError([
        {
          file: filePath,
          code: 'gate_artifact_sha256_mismatch',
          rule: 'gate artifactSha256 does not match the artifact contents',
          detail: `expected ${gate.artifactSha256}, got ${actual}`,
        },
      ])
    }
  }

  return Object.freeze(gate)
}

// --- intervention/control gates ------------------------------------

export function writeNeedsInterventionGate(
  paths: GatePaths,
  gate: NeedsInterventionGate,
): Promise<void> {
  return writeControlGate(paths, 'NEEDS_INTERVENTION.json', gate, validateNeedsIntervention)
}

export function writePauseGate(paths: GatePaths, gate: PauseGate): Promise<void> {
  return writeControlGate(paths, 'PAUSE.json', gate, validatePauseOrStop)
}

export function writeStopGate(paths: GatePaths, gate: StopGate): Promise<void> {
  return writeControlGate(paths, 'STOP.json', gate, validatePauseOrStop)
}

async function writeControlGate<T extends object>(
  paths: GatePaths,
  filename: string,
  gate: T,
  validate: (raw: unknown, file: string) => GateLoadIssue | null,
): Promise<void> {
  const targetPath = join(paths.runDir, filename)
  const issue = validate(gate, targetPath)
  if (issue !== null) throw new GateLoadError([issue])

  const json = JSON.stringify(gate, null, 2) + '\n'
  const buf = Buffer.from(json, 'utf8')

  try {
    await withLock(paths.lockDir, async () => {
      const tmpPath = `${targetPath}.tmp-${randomBytes(6).toString('hex')}`
      const fh = await open(tmpPath, 'w')
      try {
        await fh.write(buf, 0, buf.length)
        await fh.sync()
      } finally {
        await fh.close()
      }
      try {
        await rename(tmpPath, targetPath)
      } catch (err: unknown) {
        await rm(tmpPath, { force: true }).catch(() => undefined)
        throw err
      }
    })
  } catch (err: unknown) {
    if (err instanceof LockBusyError) {
      throw new GateLoadError([
        {
          file: targetPath,
          code: 'gate_lock_busy',
          rule: 'per-run lock is busy',
          detail: err.lockDir,
        },
      ])
    }
    if (err instanceof GateLoadError) throw err
    throw new GateLoadError([
      {
        file: targetPath,
        code: 'gate_io_error',
        rule: 'failed to write control gate',
        detail: (err as Error).message,
      },
    ])
  }
}

// --- helpers -------------------------------------------------------

export function validateGate(raw: unknown, file: string): GateLoadIssue | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { file, code: 'gate_invalid_json', rule: 'gate must be a non-array JSON object' }
  }
  const g = raw as Record<string, unknown>

  if (g.version !== 1) {
    return {
      file,
      code: 'gate_invalid_version',
      rule: 'gate must have version: 1',
      detail: `got ${JSON.stringify(g.version)}`,
    }
  }

  for (const required of ['runId', 'phase', 'artifact', 'agent', 'approvedBy', 'approvedAt']) {
    if (!(required in g)) {
      return {
        file,
        code: 'gate_missing_field',
        rule: `gate missing required field '${required}'`,
      }
    }
  }

  if (!isUlid(g.runId)) {
    return {
      file,
      code: 'gate_invalid_runid',
      rule: 'gate.runId must be a 26-char Crockford ULID',
      detail: `got ${JSON.stringify(g.runId)}`,
    }
  }
  if (!isPhase(g.phase)) {
    return {
      file,
      code: 'gate_invalid_phase',
      rule: `gate.phase must be one of: ${PHASES.join(' | ')}`,
      detail: `got ${JSON.stringify(g.phase)}`,
    }
  }
  if (!isIsoTimestamp(g.approvedAt)) {
    return {
      file,
      code: 'gate_invalid_timestamp',
      rule: 'gate.approvedAt must be ISO 8601',
      detail: `got ${JSON.stringify(g.approvedAt)}`,
    }
  }
  for (const f of ['artifact', 'agent', 'approvedBy'] as const) {
    if (typeof g[f] !== 'string' || (g[f] as string).length === 0) {
      return {
        file,
        code: 'gate_invalid_value',
        rule: `gate.${f} must be a non-empty string`,
      }
    }
  }
  if (g.agentProvider !== undefined && typeof g.agentProvider !== 'string') {
    return {
      file,
      code: 'gate_invalid_value',
      rule: 'gate.agentProvider must be a string when present',
    }
  }
  if (g.notes !== undefined && typeof g.notes !== 'string') {
    return { file, code: 'gate_invalid_value', rule: 'gate.notes must be a string when present' }
  }
  if (g.artifactSha256 !== undefined) {
    if (typeof g.artifactSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(g.artifactSha256)) {
      return {
        file,
        code: 'gate_invalid_value',
        rule: 'gate.artifactSha256 must be a 64-char lowercase hex string when present',
        detail: `got ${JSON.stringify(g.artifactSha256)}`,
      }
    }
  }

  // Path safety on the gate's `artifact` field. Synchronous checks here; the
  // realpath/symlink-escape check happens in resolveArtifactPath at I/O time.
  const pathIssue = validateArtifactSyncPath(g.artifact as string, file)
  if (pathIssue !== null) return pathIssue

  return null
}

function validateNeedsIntervention(raw: unknown, file: string): GateLoadIssue | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { file, code: 'gate_invalid_json', rule: 'gate must be a non-array JSON object' }
  }
  const g = raw as Record<string, unknown>
  if (g.version !== 1) return { file, code: 'gate_invalid_version', rule: 'version must be 1' }
  for (const required of ['runId', 'phase', 'agent', 'code', 'rule', 'actionableSuggestions', 'createdAt']) {
    if (!(required in g)) {
      return { file, code: 'gate_missing_field', rule: `missing required field '${required}'` }
    }
  }
  if (!isUlid(g.runId)) return { file, code: 'gate_invalid_runid', rule: 'runId must be a ULID' }
  if (!isPhase(g.phase)) return { file, code: 'gate_invalid_phase', rule: 'phase invalid' }
  if (!isIsoTimestamp(g.createdAt)) {
    return { file, code: 'gate_invalid_timestamp', rule: 'createdAt must be ISO 8601' }
  }
  for (const f of ['agent', 'code', 'rule'] as const) {
    if (typeof g[f] !== 'string' || (g[f] as string).length === 0) {
      return { file, code: 'gate_invalid_value', rule: `${f} must be non-empty string` }
    }
  }
  if (
    !Array.isArray(g.actionableSuggestions) ||
    !g.actionableSuggestions.every((s) => typeof s === 'string' && s.length > 0)
  ) {
    return {
      file,
      code: 'gate_invalid_value',
      rule: 'actionableSuggestions must be a non-empty-string array',
    }
  }
  if (g.detail !== undefined && typeof g.detail !== 'string') {
    return { file, code: 'gate_invalid_value', rule: 'detail must be a string when present' }
  }
  return null
}

function validatePauseOrStop(raw: unknown, file: string): GateLoadIssue | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { file, code: 'gate_invalid_json', rule: 'gate must be a non-array JSON object' }
  }
  const g = raw as Record<string, unknown>
  if (g.version !== 1) return { file, code: 'gate_invalid_version', rule: 'version must be 1' }
  if (!isUlid(g.runId)) return { file, code: 'gate_invalid_runid', rule: 'runId must be a ULID' }
  if (typeof g.reason !== 'string' || g.reason.length === 0) {
    return { file, code: 'gate_invalid_value', rule: 'reason must be a non-empty string' }
  }
  if (!isIsoTimestamp(g.createdAt)) {
    return { file, code: 'gate_invalid_timestamp', rule: 'createdAt must be ISO 8601' }
  }
  return null
}

function validateArtifactSyncPath(artifact: string, file: string): GateLoadIssue | null {
  if (isAbsolute(artifact)) {
    return {
      file,
      code: 'gate_artifact_path_unsafe',
      rule: 'gate.artifact must be relative to the artifact root, not absolute',
      detail: artifact,
    }
  }
  if (artifact.includes('\\')) {
    return {
      file,
      code: 'gate_artifact_path_unsafe',
      rule: 'gate.artifact must use forward slashes',
      detail: artifact,
    }
  }
  const normalized = normalize(artifact)
  if (normalized === '..' || normalized.startsWith('../')) {
    return {
      file,
      code: 'gate_artifact_path_unsafe',
      rule: 'gate.artifact must not contain `..` segments',
      detail: artifact,
    }
  }
  if (normalized.split('/').some((seg) => seg === '..')) {
    return {
      file,
      code: 'gate_artifact_path_unsafe',
      rule: 'gate.artifact must not contain `..` segments',
      detail: artifact,
    }
  }
  return null
}

async function resolveArtifactPath(
  artifact: string,
  artifactRoot: string,
  file: string,
  requireExist: boolean,
): Promise<string> {
  const resolved = resolve(artifactRoot, artifact)

  if (requireExist) {
    try {
      await stat(resolved)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new GateLoadError([
          {
            file,
            code: 'gate_artifact_missing',
            rule: 'gate.artifact does not exist on disk',
            detail: resolved,
          },
        ])
      }
      throw new GateLoadError([
        {
          file,
          code: 'gate_io_error',
          rule: 'failed to stat gate.artifact',
          detail: (err as Error).message,
        },
      ])
    }
  }

  // Symlink-escape check: realpath both sides and verify resolved is within root.
  let rootReal: string
  let resolvedReal: string
  try {
    rootReal = await realpath(artifactRoot)
    resolvedReal = await realpath(resolved)
  } catch (err: unknown) {
    if (!requireExist && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Not asked to require existence; skip realpath check.
      return resolved
    }
    throw new GateLoadError([
      {
        file,
        code: 'gate_io_error',
        rule: 'failed to resolve gate.artifact via realpath',
        detail: (err as Error).message,
      },
    ])
  }

  const rel = relative(rootReal, resolvedReal)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolved
  }
  throw new GateLoadError([
    {
      file,
      code: 'gate_artifact_path_unsafe',
      rule: 'gate.artifact resolves outside the artifact root via symlinks',
      detail: `${resolvedReal} is outside ${rootReal}`,
    },
  ])
}

async function sha256File(absPath: string): Promise<string> {
  // Streaming hash for large files. Bun's fs.readFile returns a Buffer; for
  // M3 artifact sizes (a SPEC.md, PLAN.md, etc.) reading the whole file is
  // fine. Switch to streaming if BUILD_REPORT.md grows large in M7.
  const buf = await readFile(absPath)
  const hash = createHash('sha256')
  hash.update(buf)
  return hash.digest('hex')
}

async function tryReadGate(filePath: string): Promise<GateFile | null> {
  let raw: unknown
  try {
    const content = await readFile(filePath, 'utf8')
    raw = JSON.parse(content)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    return null // best effort; idempotency only matters when the existing file is parseable
  }
  const issue = validateGate(raw, filePath)
  if (issue !== null) return null
  return raw as GateFile
}

function gatesEqual(a: GateFile, b: GateFile): boolean {
  return (
    a.version === b.version &&
    a.runId === b.runId &&
    a.phase === b.phase &&
    a.artifact === b.artifact &&
    a.artifactSha256 === b.artifactSha256 &&
    a.agent === b.agent &&
    a.agentProvider === b.agentProvider &&
    a.approvedBy === b.approvedBy &&
    a.approvedAt === b.approvedAt &&
    a.notes === b.notes
  )
}

// Exported for test fixtures and external tools that want to re-derive the
// canonical filename for a phase.
export { validateArtifactSyncPath as _validateArtifactSyncPath }
