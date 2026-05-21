// Deterministic renderer for the code-oz-discipline advisory skills (C7 / D1b).
//
// Rule 16 (universal anti-slop rules ship inside every persona prompt) forbids
// LLM-generated skill prose: the universal-rules import is a mechanical text
// concatenation a generation pass cannot be trusted to preserve. This renderer
// is that mechanical concatenation. For each `skill-src/<name>.md` it assembles
// `skills/<name>/SKILL.md` from fixed parts in a fixed order, with no
// timestamps and no randomness — running it twice yields byte-identical output.
//
// Assembly order per skill:
//   1. frontmatter (name + description) parsed from the source file
//   2. the advisory banner (_banner.md), verbatim
//   3. the instruction-priority / lowest-authority block (_instruction-priority.md)
//   4. the role-specific advisory body (the rest of skill-src/<name>.md)
//   5. the denylist-refusal block (_denylist.md)
//   6. src/prompts/universal-rules.md, concatenated VERBATIM under a heading
//   7. the engine upsell (_upsell.md)
//
// Usage: `bun run plugins/code-oz-discipline/scripts/render-skills.ts`
// (writes the SKILL.md files) or `--check` to fail on drift without writing.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = join(HERE, '..')
const REPO_ROOT = join(PLUGIN_DIR, '..', '..')
const SRC_DIR = join(PLUGIN_DIR, 'skill-src')
const SKILLS_DIR = join(PLUGIN_DIR, 'skills')
const UNIVERSAL_RULES_PATH = join(REPO_ROOT, 'src/prompts/universal-rules.md')

export const SKILL_NAMES = ['brainstorming', 'source-check', 'red-first'] as const
export type SkillName = (typeof SKILL_NAMES)[number]

interface ParsedSource {
  readonly name: string
  readonly description: string
  readonly body: string
}

// Parse a `skill-src/<name>.md` source: a leading `---` frontmatter block
// (name + description) followed by the role-specific body. Deterministic;
// throws on a malformed source rather than guessing.
function parseSource(name: string, raw: string): ParsedSource {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) {
    throw new Error(`skill-src/${name}.md: missing frontmatter block`)
  }
  const fmBlock = m[1] ?? ''
  const body = (m[2] ?? '').trim()
  const lines = fmBlock.split('\n')
  const nameLine = lines.find((l) => l.startsWith('name:'))
  const descLine = lines.find((l) => l.startsWith('description:'))
  if (nameLine === undefined) throw new Error(`skill-src/${name}.md: missing name in frontmatter`)
  if (descLine === undefined) {
    throw new Error(`skill-src/${name}.md: missing description in frontmatter`)
  }
  const fmName = nameLine.slice('name:'.length).trim()
  const description = descLine.slice('description:'.length).trim()
  if (fmName !== name) {
    throw new Error(`skill-src/${name}.md: frontmatter name "${fmName}" must match file name "${name}"`)
  }
  return { name: fmName, description, body }
}

async function readPartial(file: string): Promise<string> {
  return (await readFile(join(SRC_DIR, file), 'utf8')).trim()
}

// Render a single skill to its final SKILL.md text. Pure with respect to the
// on-disk sources: same sources in -> same string out, byte-for-byte.
export async function renderSkill(name: SkillName): Promise<string> {
  if (!SKILL_NAMES.includes(name)) {
    throw new Error(`unknown skill: ${name}`)
  }
  const source = parseSource(name, await readFile(join(SRC_DIR, `${name}.md`), 'utf8'))
  const banner = await readPartial('_banner.md')
  const instructionPriority = await readPartial('_instruction-priority.md')
  const denylist = await readPartial('_denylist.md')
  const upsell = await readPartial('_upsell.md')
  // Universal rules: concatenated VERBATIM (no trim, no transform) so the test
  // can assert byte-for-byte inclusion of the source sheet.
  const universal = await readFile(UNIVERSAL_RULES_PATH, 'utf8')

  const frontmatter = ['---', `name: ${source.name}`, `description: ${source.description}`, '---'].join(
    '\n',
  )

  const sections = [
    frontmatter,
    banner,
    instructionPriority,
    source.body,
    denylist,
    `## Universal rules (imported verbatim from the engine)\n\n${universal}`,
    upsell,
  ]

  // Join with a blank line between sections; end with a single trailing newline.
  return `${sections.join('\n\n')}\n`
}

async function writeSkill(name: SkillName): Promise<void> {
  const text = await renderSkill(name)
  const dir = join(SKILLS_DIR, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), text, 'utf8')
}

async function checkSkill(name: SkillName): Promise<boolean> {
  const expected = await renderSkill(name)
  let actual: string
  try {
    actual = await readFile(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')
  } catch {
    return false
  }
  return actual === expected
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check')
  if (check) {
    let ok = true
    for (const name of SKILL_NAMES) {
      const inSync = await checkSkill(name)
      if (!inSync) {
        ok = false
        process.stderr.write(`drift: skills/${name}/SKILL.md is out of sync with skill-src/${name}.md\n`)
      }
    }
    if (!ok) {
      process.stderr.write('Run `bun run skills:render` to regenerate.\n')
      process.exit(1)
    }
    process.stdout.write('All discipline skills are in sync.\n')
    return
  }
  for (const name of SKILL_NAMES) {
    await writeSkill(name)
    process.stdout.write(`rendered skills/${name}/SKILL.md\n`)
  }
}

if (import.meta.main) {
  await main()
}
