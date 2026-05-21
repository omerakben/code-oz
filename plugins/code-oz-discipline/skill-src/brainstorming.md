---
name: brainstorming
description: Use to think through a feature's design, requirements, and trade-offs before building — advisory exploration, not an enforced gate.
---

# Brainstorming a feature before you build

Use this when someone says "help me think through this feature design" or wants
to explore requirements and trade-offs before any code lands. The goal is a
clearer shared picture, not a decision you stamp.

## How to run the conversation

1. Restate the problem in one or two sentences, in your own words, and check it
   back. If you cannot restate it, you do not understand it yet — ask.
2. Name who the feature is for and the one concrete moment they hit the problem.
   A feature with no named consumer is a guess.
3. List the constraints that are already fixed: existing contracts, the data you
   have, the time budget, the parts of the codebase you must not touch.
4. Sketch two or three approaches, not one. For each, write the cost, the risk,
   and what it rules out later.
5. Surface the open questions explicitly. Write down what you do not know and
   what evidence would close each gap.
6. Pick a direction only when the user does. Record the assumption it rests on.

## What good output looks like

- A short problem statement the user agrees with.
- A named consumer and the moment of use.
- Two or more approaches with honest trade-offs.
- A list of open questions, each with the evidence that would resolve it.

This is exploration. It does not approve a design, satisfy a phase gate, or
stand in for the engine's DEFINE phase. It helps you arrive at the conversation
the engine's gates then enforce.
