# Common Rationalizations

Reasons agents and users use to skip a step in the SDLC, and why each one is wrong.

| Rationalization | Reality |
|---|---|
| "We can leave that for later." | Open questions become irrecoverable scope creep three phases downstream. Capture them in `## Open questions` even if they're vague. |
| "The user will tell us if it's wrong." | Non-technical users do not know what they do not know. Surface assumptions explicitly so the user has something concrete to disagree with. |
| "This is too small to need acceptance criteria." | Without acceptance criteria, REVIEW has nothing to verify against and falls back to LLM judgment. Always specify a verifiable check, even for trivial features. |
| "Non-goals are obvious." | Implicit non-goals are how scope creep happens. State at least one explicit non-goal — filler is acceptable, absence is not. |
| "The persona's draft looks good enough." | Structural validation is mechanical; voice is human. Validate the structure deterministically, edit the voice manually. |
| "We can adjust the spec later if we missed something." | The DEFINE gate sha256-binds SPEC.md at approval time. Edits after approval invalidate the gate. Get it right before approving. |
| "The user did not mention X, so X must not matter." | Users omit constraints they take for granted. Ask about deployment target, runtime budget, and existing systems even if they did not surface. |
| "More questions will only confuse the user." | One focused question at a time is calibration, not interrogation. Compound questions ("what platform AND what budget") are the confusing pattern. |
