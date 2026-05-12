import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'yaml'

const repoRoot = process.cwd()
const testYmlPath = join(repoRoot, '.github/workflows/test.yml')
const releaseYmlPath = join(repoRoot, '.github/workflows/release.yml')

function loadYaml(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`workflow file missing at ${path}`)
  }
  return yaml.parse(readFileSync(path, 'utf8'))
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected object, got ${typeof value}`)
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`expected array, got ${typeof value}`)
  }
  return value
}

describe('.github/workflows/test.yml', () => {
  test('exists and parses as YAML', () => {
    expect(() => loadYaml(testYmlPath)).not.toThrow()
  })

  test('triggers on push and pull_request', () => {
    const doc = asObject(loadYaml(testYmlPath))
    // YAML parses `on:` as the literal key "on". yaml lib may interpret unquoted
    // `on:` as boolean true; we look up both for resilience.
    const trigger = (doc.on ?? (doc as { true?: unknown }).true) as
      | Record<string, unknown>
      | undefined
    expect(trigger).toBeDefined()
    const triggerObj = asObject(trigger)
    expect(Object.keys(triggerObj)).toEqual(expect.arrayContaining(['push', 'pull_request']))
  })

  test('runs matrix across ubuntu-latest and macos-latest', () => {
    const doc = asObject(loadYaml(testYmlPath))
    const jobs = asObject(doc.jobs)
    const firstJob = asObject(Object.values(jobs)[0])
    const strategy = asObject(firstJob.strategy)
    const matrix = asObject(strategy.matrix)
    const os = asArray(matrix.os)
    expect(os).toEqual(expect.arrayContaining(['ubuntu-latest', 'macos-latest']))
  })

  test('invokes bun install, typecheck, and test', () => {
    const doc = asObject(loadYaml(testYmlPath))
    const jobs = asObject(doc.jobs)
    const firstJob = asObject(Object.values(jobs)[0])
    const steps = asArray(firstJob.steps)
    const runCommands = steps
      .map((step) => asObject(step).run)
      .filter((cmd): cmd is string => typeof cmd === 'string')
      .join('\n')
    expect(runCommands).toContain('bun install')
    expect(runCommands).toContain('bun run typecheck')
    expect(runCommands).toContain('bun test')
  })

  test('pins oven-sh/setup-bun action', () => {
    const doc = asObject(loadYaml(testYmlPath))
    const jobs = asObject(doc.jobs)
    const firstJob = asObject(Object.values(jobs)[0])
    const steps = asArray(firstJob.steps)
    const usesEntries = steps
      .map((step) => asObject(step).uses)
      .filter((value): value is string => typeof value === 'string')
    expect(usesEntries.some((u) => u.startsWith('oven-sh/setup-bun@'))).toBe(true)
  })
})

describe('.github/workflows/release.yml', () => {
  test('exists and parses as YAML', () => {
    expect(() => loadYaml(releaseYmlPath)).not.toThrow()
  })

  test('triggers on v* tag push', () => {
    const doc = asObject(loadYaml(releaseYmlPath))
    const trigger = (doc.on ?? (doc as { true?: unknown }).true) as
      | Record<string, unknown>
      | undefined
    expect(trigger).toBeDefined()
    const triggerObj = asObject(trigger)
    const push = asObject(triggerObj.push)
    const tags = asArray(push.tags)
    expect(tags.some((t) => typeof t === 'string' && t.startsWith('v'))).toBe(true)
  })

  test('build matrix covers all four W3a targets', () => {
    const doc = asObject(loadYaml(releaseYmlPath))
    const jobs = asObject(doc.jobs)
    const build = asObject(jobs.build)
    const strategy = asObject(build.strategy)
    const matrix = asObject(strategy.matrix)
    const include = asArray(matrix.include).map((row) => asObject(row))
    const triples = include
      .map((row) => `${String(row.os ?? '')}-${String(row.arch ?? '')}`)
      .sort()
    expect(triples).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
    ])
  })

  test('each build matrix entry pairs a runner with bun target', () => {
    const doc = asObject(loadYaml(releaseYmlPath))
    const jobs = asObject(doc.jobs)
    const build = asObject(jobs.build)
    const strategy = asObject(build.strategy)
    const matrix = asObject(strategy.matrix)
    const include = asArray(matrix.include).map((row) => asObject(row))
    for (const row of include) {
      expect(typeof row.runner).toBe('string')
      expect(typeof row.bunTarget).toBe('string')
      const bunTarget = String(row.bunTarget)
      expect(bunTarget.startsWith('bun-')).toBe(true)
      const runner = String(row.runner)
      const expectedRunner = String(row.os) === 'darwin' ? 'macos-latest' : 'ubuntu-latest'
      expect(runner).toBe(expectedRunner)
    }
  })

  test('build step compiles via bun build --compile', () => {
    const doc = asObject(loadYaml(releaseYmlPath))
    const jobs = asObject(doc.jobs)
    const build = asObject(jobs.build)
    const steps = asArray(build.steps)
    const runScripts = steps
      .map((step) => asObject(step).run)
      .filter((cmd): cmd is string => typeof cmd === 'string')
      .join('\n')
    expect(runScripts).toContain('bun build')
    expect(runScripts).toContain('--compile')
  })

  test('release job assembles checksums and creates a GitHub release', () => {
    const doc = asObject(loadYaml(releaseYmlPath))
    const jobs = asObject(doc.jobs)
    const release = asObject(jobs.release)
    const needs = release.needs
    expect(needs === 'build' || (Array.isArray(needs) && needs.includes('build'))).toBe(true)
    const steps = asArray(release.steps)
    const runScripts = steps
      .map((step) => asObject(step).run)
      .filter((cmd): cmd is string => typeof cmd === 'string')
      .join('\n')
    expect(runScripts).toContain('checksums.txt')
    expect(runScripts).toContain('gh release')
  })

  test('release job uploads install.sh alongside the tarballs', () => {
    const doc = asObject(loadYaml(releaseYmlPath))
    const jobs = asObject(doc.jobs)
    const release = asObject(jobs.release)
    const steps = asArray(release.steps)
    const text = JSON.stringify(steps)
    expect(text).toContain('install.sh')
  })

  test('per-arch tarball asset naming binds version, os, arch', () => {
    const raw = readFileSync(releaseYmlPath, 'utf8')
    // Asset names are built in shell with env vars VERSION / MATRIX_OS /
    // MATRIX_ARCH (fed from ${{ steps.version.outputs.VERSION }} and matrix
    // contexts via env: blocks). Workflow injection guidance forbids
    // splicing ${{ matrix.* }} directly inside run: scripts.
    expect(raw).toMatch(
      /code-oz-v\$\{VERSION\}-\$\{MATRIX_OS\}-\$\{MATRIX_ARCH\}\.tar\.gz/,
    )
    // The matrix env wiring must exist so VERSION / MATRIX_OS / MATRIX_ARCH
    // are populated under the create-tarball step.
    expect(raw).toMatch(/MATRIX_OS:\s+\${{\s*matrix\.os\s*}}/)
    expect(raw).toMatch(/MATRIX_ARCH:\s+\${{\s*matrix\.arch\s*}}/)
  })
})

describe('release.yml ↔ consumer layout contract (W3a R1)', () => {
  // The release workflow stages a per-arch tarball that two consumers
  // (scripts/install.sh, npm-wrapper/index.cjs) decompress and read. Both
  // expect:
  //   - top-level dir: code-oz-v${VERSION}-${OS}-${ARCH}/
  //   - inside: code-oz, manifest.json (install.sh + npm wrapper read it)
  //   - inside: install.sh, README.md (install.sh ships in the tarball;
  //     README documents the per-arch bundle)
  // If release.yml ever drifts away from this layout, the integration tests
  // that mock release stores with hand-built fixtures will keep passing
  // while real CI-built tarballs break the consumers. This contract test
  // pins the staging step to the layout both consumers rely on.
  const releaseYml = readFileSync(releaseYmlPath, 'utf8')
  const installScript = readFileSync(join(repoRoot, 'scripts/install.sh'), 'utf8')
  const npmWrapper = readFileSync(join(repoRoot, 'npm-wrapper/index.cjs'), 'utf8')

  test('STAGE_NAME shape matches both install.sh and npm wrapper expectations', () => {
    // release.yml builds: STAGE_NAME="code-oz-v${VERSION}-${MATRIX_OS}-${MATRIX_ARCH}"
    expect(releaseYml).toMatch(
      /STAGE_NAME="code-oz-v\$\{VERSION\}-\$\{MATRIX_OS\}-\$\{MATRIX_ARCH\}"/,
    )
    // install.sh derives:   stage_name="code-oz-v${version_num}-${os}-${arch}"
    expect(installScript).toMatch(
      /stage_name="code-oz-v\$\{version_num\}-\$\{os\}-\$\{arch\}"/,
    )
    // npm wrapper derives:  const stageName = `code-oz-v${version}-${host.os}-${host.arch}`
    expect(npmWrapper).toMatch(
      /const stageName = `code-oz-v\$\{version\}-\$\{host\.os\}-\$\{host\.arch\}`/,
    )
  })

  test('every file the consumers read from the tarball is staged in release.yml', () => {
    // Both consumers look up these paths inside the extracted top-level
    // directory. release.yml must stage all of them into STAGE_DIR.
    expect(installScript).toMatch(/extracted_dir\/manifest\.json/)
    expect(npmWrapper).toMatch(/cacheDir,\s*stageName,\s*'code-oz'/)

    // STAGE_DIR file layout per release.yml:
    //   - code-oz       (the binary; cp from BIN_DIR)
    //   - install.sh    (cp scripts/install.sh)
    //   - manifest.json (cat > ${STAGE_DIR}/manifest.json)
    //   - README.md     (cat > ${STAGE_DIR}/README.md)
    expect(releaseYml).toMatch(/cp "\$\{BIN_DIR\}\/code-oz" "\$\{STAGE_DIR\}\/code-oz"/)
    expect(releaseYml).toMatch(/cp scripts\/install\.sh "\$\{STAGE_DIR\}\/install\.sh"/)
    expect(releaseYml).toMatch(/cat > "\$\{STAGE_DIR\}\/manifest\.json"/)
    expect(releaseYml).toMatch(/cat > "\$\{STAGE_DIR\}\/README\.md"/)
  })

  test('tarball top-level dir name equals STAGE_NAME (no extra wrapping)', () => {
    // tar -C dist -czf "dist/${ASSET_NAME}" "${STAGE_NAME}" preserves the
    // ${STAGE_NAME} top-level dir. Consumers expect this dir as the only
    // entry inside the tarball.
    expect(releaseYml).toMatch(
      /tar -C dist -czf "dist\/\$\{ASSET_NAME\}" "\$\{STAGE_NAME\}"/,
    )
  })
})
