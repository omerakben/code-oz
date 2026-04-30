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
