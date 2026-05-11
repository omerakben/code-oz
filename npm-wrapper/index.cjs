#!/usr/bin/env node

// code-oz npm launcher. Reads the package version, resolves the platform
// binary from ~/.cache/code-oz/<version>/code-oz (downloading + verifying it
// on cache miss), then execs it with the user's argv. No bun dependency on
// the user's machine. No postinstall hook (runs on first invocation), so
// survives `npm ci --ignore-scripts`.
//
// Override hooks (test/internal only — never set in production):
//   CODE_OZ_NPM_BASE_URL   base URL containing tarballs + checksums.txt
//                          (defaults to the GitHub release for this version)
//   CODE_OZ_NPM_CACHE_DIR  cache root (defaults to $HOME/.cache/code-oz)

'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const GH_OWNER = 'omerakben'
const GH_REPO = 'code-oz'

function die(message) {
  process.stderr.write(`code-oz launcher: ${message}\n`)
  process.exit(1)
}

function readPackageVersion() {
  const pkgPath = path.join(__dirname, '..', 'package.json')
  let raw
  try {
    raw = fs.readFileSync(pkgPath, 'utf8')
  } catch (err) {
    die(`cannot read ${pkgPath}: ${err.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    die(`package.json is not valid JSON: ${err.message}`)
  }
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    die('package.json missing string "version"')
  }
  return parsed.version
}

function detectPlatform() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    die(
      `unsupported platform: ${process.platform}. Supported: darwin, linux. ` +
        'Windows is deferred to v0.20.1.',
    )
  }
  if (process.arch !== 'arm64' && process.arch !== 'x64') {
    die(`unsupported architecture: ${process.arch}. Supported: arm64, x64.`)
  }
  return { os: process.platform, arch: process.arch }
}

async function download(url, destination) {
  if (url.startsWith('file://')) {
    const sourcePath = url.slice('file://'.length)
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`source file does not exist: ${sourcePath}`)
    }
    await fs.promises.copyFile(sourcePath, destination)
    return
  }
  const protocol = url.startsWith('https://') ? require('node:https') : require('node:http')
  await new Promise((resolve, reject) => {
    const request = protocol.get(url, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        download(response.headers.location, destination).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        response.resume()
        reject(new Error(`HTTP ${status} for ${url}`))
        return
      }
      const fileStream = fs.createWriteStream(destination)
      pipeline(Readable.from(response), fileStream).then(resolve, reject)
    })
    request.on('error', reject)
    request.setTimeout(60_000, () => {
      request.destroy(new Error(`timeout downloading ${url}`))
    })
  })
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function findChecksumEntry(text, assetName) {
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (line.length === 0) continue
    const match = line.match(/^([0-9a-f]+)\s+\*?(.+)$/i)
    if (!match) continue
    const [, sha, name] = match
    if (name.trim() === assetName) return sha.toLowerCase()
  }
  return null
}

function extractTarball(tarballPath, destinationDir) {
  const result = spawnSync('tar', ['-C', destinationDir, '-xzf', tarballPath], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (result.status !== 0) {
    throw new Error(`tar exited with status ${result.status}`)
  }
}

async function ensureBinary({ version, host, cacheRoot, baseUrl }) {
  const cacheDir = path.join(cacheRoot, version)
  const cachedBinary = path.join(cacheDir, 'code-oz')
  if (fs.existsSync(cachedBinary)) return cachedBinary

  await fs.promises.mkdir(cacheDir, { recursive: true })
  const stageName = `code-oz-v${version}-${host.os}-${host.arch}`
  const assetName = `${stageName}.tar.gz`
  const tarballPath = path.join(cacheDir, assetName)
  const checksumsPath = path.join(cacheDir, 'checksums.txt')

  try {
    await download(`${baseUrl}/${assetName}`, tarballPath)
  } catch (err) {
    throw new Error(`failed to download ${baseUrl}/${assetName}: ${err.message}`)
  }
  try {
    await download(`${baseUrl}/checksums.txt`, checksumsPath)
  } catch (err) {
    throw new Error(`failed to download ${baseUrl}/checksums.txt: ${err.message}`)
  }

  const checksumsText = fs.readFileSync(checksumsPath, 'utf8')
  const expectedSha = findChecksumEntry(checksumsText, assetName)
  if (!expectedSha) {
    throw new Error(`no checksum entry for ${assetName} in checksums.txt at ${baseUrl}`)
  }
  const actualSha = sha256File(tarballPath)
  if (actualSha !== expectedSha) {
    throw new Error(`checksum mismatch for ${assetName}: expected ${expectedSha}, got ${actualSha}`)
  }

  extractTarball(tarballPath, cacheDir)
  const stagedBinary = path.join(cacheDir, stageName, 'code-oz')
  if (!fs.existsSync(stagedBinary)) {
    throw new Error(`extracted tarball missing binary at ${stagedBinary}`)
  }

  await fs.promises.copyFile(stagedBinary, cachedBinary)
  await fs.promises.chmod(cachedBinary, 0o755)
  await fs.promises.rm(path.join(cacheDir, stageName), { recursive: true, force: true })
  await fs.promises.rm(tarballPath, { force: true })
  await fs.promises.rm(checksumsPath, { force: true })
  return cachedBinary
}

async function main() {
  const version = readPackageVersion()
  const host = detectPlatform()
  const cacheRoot = process.env.CODE_OZ_NPM_CACHE_DIR
    || path.join(os.homedir(), '.cache', 'code-oz')
  const baseUrl = process.env.CODE_OZ_NPM_BASE_URL
    || `https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/v${version}`

  let binary
  try {
    binary = await ensureBinary({ version, host, cacheRoot, baseUrl })
  } catch (err) {
    die(err.message)
  }

  const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' })
  child.on('error', (err) => die(`failed to exec ${binary}: ${err.message}`))
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

main().catch((err) => die(err.message))
