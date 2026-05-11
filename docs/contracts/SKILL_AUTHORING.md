---
name: skill authoring (description and trigger conventions)
companion-docs: ../../CLAUDE.md (rule 16 — universal anti-slop is *execution* discipline; this doc is *metadata* discipline), ../research/01-maestro-rule-checker.md (the maestro discipline; persona descriptions are subject to this contract)
target: any skill, agent-pack metadata entry, or persona description that may be listed in a budget-capped catalog
status: convention — applies to authoring only, not to runtime execution
source: `~/Projects/agents/templates/learn-harness-engineering/skills/harness-creator/references/gotchas.md` lines 151-162 (Gotcha #12)
---

# SKILL_AUTHORING.md — description and trigger conventions

## Disclaimer — this is not anti-slop discipline

This document is **not** part of `src/prompts/universal-rules.md`. That file is reserved for execution-time anti-slop discipline (rule 16). This document is metadata authoring guidance — how to write a skill description so it survives truncation in a budget-capped catalog. The two concerns are complementary, not overlapping. Mixing them would dilute rule 16's authority over runtime output.

## 1. The problem

Skill-listing budgets are tight. Most catalogs concatenate skill descriptions and cap each entry at roughly 150 characters. Some surfaces are tighter — a few catalogs render only the first 60-80 characters before truncating in the visible UI. The trigger language that makes a skill *discriminable* must live in those first characters, or the skill will fail to fire when its trigger keywords are referenced.

Source: `~/Projects/agents/templates/learn-harness-engineering/skills/harness-creator/references/gotchas.md` lines 151-162 (Gotcha #12, "Skill Listing Budgets Are Tight").

The failure mode is silent. A perfectly written description can fail to trigger because the discriminating words are at the end of a sentence that gets cut. The author sees a polished description; the catalog shows a generic-looking opening; the runtime never matches the trigger.

## 2. The convention

**Front-load distinctive trigger language.** Put the words that make this skill different from every other skill at the *start* of the description, not at the end. Treat the description as a list of trigger keywords with light connective tissue, not as a paragraph.

Three good-vs-bad pairs.

### Pair 1 — generic skill description

- **Good**: `harness-patterns: Memory, permissions, context engineering, multi-agent`
- **Bad**: `A comprehensive skill for understanding and implementing various patterns related to AI agent harnesses and runtime systems...`

The good version puts every discriminating word in the first 60 characters. The bad version buries them behind filler ("comprehensive", "various", "related to") that says nothing the skill name does not already imply.

### Pair 2 — code-oz Reviewer persona

- **Good**: `Reviewer: cross-family adversarial review at REVIEW gate; reads files, never summaries; 4-round cap; score plus verdict`
- **Bad**: `The Reviewer persona is responsible for performing comprehensive reviews of code changes and providing feedback on quality, correctness, and adherence to project standards across various dimensions.`

The good version names the persona's distinctive primitives: cross-family, files-not-summaries, 4-round cap, score plus verdict. A reader hitting truncation at character 80 still sees "cross-family adversarial review at REVIEW gate; reads files, never summaries". The bad version reads as a generic role description; truncation at character 80 yields "The Reviewer persona is responsible for performing comprehensive reviews of code", which is indistinguishable from any other reviewer skill in any other system.

### Pair 3 — hypothetical agent-pack entry

- **Good**: `xai-grok: HTTP adapter, OpenAI-compatible subset, strict allowlist, built-in xAI tools disabled, buffered responses`
- **Bad**: `An agent-pack entry that provides integration with the xAI Grok family of models through their HTTP API, supporting standard chat completion patterns and various configuration options for production use.`

The good version puts the audit-relevant facts up front: HTTP adapter (vs subprocess), OpenAI-compatible subset, strict allowlist, tools disabled. The bad version has the same words but buries them past the 100-character mark, where many catalogs have already truncated.

### Filler to avoid

The following words and phrases are tail-heavy by construction. They consume characters without adding trigger value:

- "comprehensive", "various", "related to", "and other", "a wide range of"
- "responsible for", "designed to", "supports"
- "across various dimensions", "in production use", "for general use"

Compress descriptions to scannable form: the reader sees only the first 60-80 characters in many catalogs. Every character before character 80 should be a trigger keyword or essential connective.

## 3. Application to code-oz

Several surfaces in code-oz are subject to this convention today:

- **Persona YAML frontmatter.** Each persona under `src/prompts/personas/` (or wherever personas live in the runtime) has a `description` field. That field is the catalog entry when personas are enumerated. Front-load the persona's distinctive primitives.
- **Maestro dossier persona introductions.** The maestro dossier (`docs/research/01-maestro-rule-checker.md`) introduces personas in prose. Where a one-line summary appears at the start of a persona section, the same convention applies: distinctive language up front.
- **Future `code-oz skill list` output.** When the runtime exposes a skill or persona list to users, that list will be subject to the same caps. Authors should write descriptions assuming truncation today, not retrofit later.

**Cross-reference**: rule 16 in `CLAUDE.md` (universal anti-slop) governs *execution* — the words an agent generates at runtime, in artifacts, in prose responses. This convention governs *metadata* — the words an author writes in a description field that the runtime will list. They are complementary. An anti-slop persona description can still bury its trigger language; this convention catches that. A well-described persona can still produce slop output; rule 16 catches that.

The two should be authored together but lived separately: anti-slop rules belong in `src/prompts/universal-rules.md` and reach the persona at runtime via prompt assembly; description conventions belong here and reach the persona at authoring time via the writer's discipline.

## 4. Anti-patterns

1. **Burying trigger language behind filler.** Every word before the first discriminating noun is a missed character. If "comprehensive" is the first word, the description is broken.
2. **Description longer than 150 characters.** The tail will truncate in most catalogs. Write to the cap; do not write past it and hope.
3. **Description that paraphrases the skill name.** "harness-patterns: a skill for working with harness patterns" adds zero information. The description's job is to add what the name cannot say in two words.
4. **Synonym cycling.** "AI", "ML", "intelligent system" all in one description waste characters cycling through near-synonyms. Pick one and use it.
5. **Multi-sentence descriptions.** A single comma-separated keyword list survives truncation cleanly. A two-sentence description loses the second sentence and any keyword in it.
6. **Self-promotional adjectives.** "powerful", "robust", "production-grade", "enterprise-ready" are all tail-bait. Drop them; let the keyword list speak.

## 5. Quality check before publishing

Before committing a new skill, persona, or agent-pack description, run this checklist:

1. **Character count.** Count the description. If it exceeds 150 characters, cut. Compress filler before cutting trigger keywords.
2. **First-80-character test.** Read the first 80 characters in isolation. Does the reader know what makes this skill different from a generic version? If not, reorder.
3. **Filler scan.** Search the description for: "comprehensive", "various", "related to", "responsible for", "designed to", "across various", "wide range", "in production", "for general use". Each match is a candidate cut.
4. **Synonym scan.** Search for near-synonyms in the same description ("AI" + "ML"; "system" + "platform" + "framework"). Pick one and remove the rest.
5. **Self-paraphrase scan.** If the description begins by repeating words from the name (e.g., `harness-patterns: ...skill for harness patterns...`), cut the repetition.
6. **Sentence count.** Prefer one sentence or one comma-separated keyword list. Two sentences risk losing the second to truncation.

A description that passes all six is publishable. A description that fails any is brittle in catalogs and should be rewritten before merging.

## 6. Relationship to the maestro discipline

The maestro dossier (`docs/research/01-maestro-rule-checker.md`) is the authority on persona behavior. Persona descriptions in the dossier and in `src/prompts/personas/` frontmatter are subject to this contract. Where the two interact:

- The maestro dossier names the persona and describes its function in prose. The function description should follow the front-load rule when condensed into a one-line summary.
- The persona's `description` field in YAML frontmatter is the catalog entry. It is governed by this document.
- Updates to a persona's primary function (a maestro-dossier-level change) trigger a corresponding update to the persona's description field, applying the conventions above.

The dossier is the spec; this document is the writing convention for the spec's catalog representation.
