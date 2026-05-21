---
name: source-check
description: Use to verify spec, reference code, and library docs before writing code — advisory guidance on the 3-source discipline, not an enforced gate.
---

# Checking your sources before you write code

Use this when you are about to write code and want to ground it first. The
discipline is simple: confirm three sources before the first line lands.

## The three sources

1. **Spec.** What is the feature supposed to do? Quote the requirement you are
   building against. If it is verbal or vague, write it down and confirm it.
2. **Reference code.** Find the existing code you are extending or mirroring.
   Read it in the current turn and quote the lines you are relying on. Search
   the repo before you introduce a new helper or pattern.
3. **Library docs.** For every third-party API you call, quote one line of its
   documentation that justifies the call, and pin the version you read.

## How to use it

- Write each source down with a concrete pointer: a file and line, a doc URL, a
  quoted requirement. "I think" and "this should" are not sources.
- If a source is missing, that is the finding — stop and get it before coding.
- Keep these notes informal and non-canonical. They are your working evidence,
  not an artifact.

## What this is not

This skill advises the 3-source habit. It does **not** emit a `SOURCE_CHECK.md`
file and it does **not** satisfy the engine's enforced PLAN source-check. The
enforced version is a real gate the engine validates and blocks on. If you want
that — a `SOURCE_CHECK.md` the engine checks before PLAN can pass — refuse to
fake it here and run `code-oz run` instead.
