---
persona: ba
userRole: non-technical-parent
maxRounds: 8
expectedSpec: tests/fixtures/specs/nontechnical-baby-game.md
---

# Non-technical baby naming game — fixture

Three turns. The third BA reply emits the ready signal followed by a
canonical SPEC.md draft. `code-oz run --provider fake --request-file`
loads user turns from the user blocks and pre-scripts FakeProvider
expectations from the ba blocks.

<!-- turn:user -->
I want a small phone app that helps me name my baby.
<!-- /turn -->

<!-- turn:ba -->
Got it. To narrow this down, what is the surname the baby will share so I can frame the suggestions, and is the baby already born or are you choosing in advance?
<!-- /turn -->

<!-- turn:user -->
Surname is "Akben". The baby is due in three months.
<!-- /turn -->

<!-- turn:ba -->
Helpful. One assumption I'd like you to correct: I'm assuming you want the app to suggest given names that pair well rhythmically with "Akben" and are easy to say out loud. Is that the right framing, or do you want broader filters like cultural origin or letter patterns?
<!-- /turn -->

<!-- turn:user -->
Yes, rhythm and ease of saying out loud is exactly what I'm after. Cultural origin doesn't matter to me.
<!-- /turn -->

<!-- turn:ba -->
<spec-ready/>
# SPEC

## Goals

- Help a parent name their newborn by suggesting given names that pair rhythmically with a fixed surname.
- Suggest names that are easy to say out loud.

## Users

- An expecting parent with a fixed surname who wants suggestions for given names.

## Constraints

- Runs locally on a phone-class device.
- No internet access required after install.

## Acceptance criteria

- Given a surname, the app produces 5 candidate given names.
- Each candidate has a rhythm score against the surname and a pronounceability score.

## Open questions

- Should suggestions be gender-neutral by default or filtered?

## Explicit non-goals

- Not building a name registry or social-sharing surface.
- Not generating surnames.
<!-- /turn -->
