# Product principles

1. Time to first meaningful playback must be near zero.
2. Every screen must have a single obvious purpose.
3. Remove unnecessary UI.
4. Optimize for thumb ergonomics.
5. Every animation must communicate something.
6. No decorative complexity.
7. Visual hierarchy must be immediately understandable.
8. No feature should exist without a measurable user benefit.
9. Never sacrifice perceived quality for feature count.
10. Build for global localization from day one.
11. Instrument every important user behavior.
12. Prefer simple architecture that can evolve.
13. No premature abstraction.
14. Never hardcode content business logic into UI.
15. Accessibility is mandatory.

## Design system principles (Prompt B)

1. **Content is the hero** — UI never competes with the story.
2. **One primary action** — each surface has one dominant purpose.
3. **Zero visual noise** — remove anything that does not improve comprehension or emotion.
4. **Cinematic, not decorative** — intentional and editorial.
5. **Motion has a job** — state, continuity, hierarchy, or delight — never animation for its own sake.
6. **Premium through restraint** — do not manufacture “premium” with effects.
7. **Fast should look fast** — responsiveness is visible before interaction.
8. **Touch-first** — comfortable one-handed use; hit targets ≥ 44pt.
9. **Global by default** — long copy, writing systems, RTL readiness, Dynamic Type.
10. **System over screens** — reusable tokens/primitives over one-off styling.

## Feature gate (mandatory before any new feature)

Challenge the request:

- Is this essential to the core product?
- Does it improve activation, retention, discovery, sharing, or monetization?
- Could the user achieve the same outcome with less UI?
- Does this introduce complexity or maintenance burden?
- Could this be tested as an experiment first?

If not clearly justified: **do not build it**.

Optimize for: **SPEED + BEAUTY + SIMPLICITY + RETENTION**.

## Quality bar (definition of done per feature)

1. Does it reduce friction?
2. Does it improve delight?
3. Does it improve discovery?
4. Is it fast?
5. Does it look excellent on a small screen?
6. Is it accessible?
7. Is it instrumented?
8. Is it testable?
9. Is it localization-ready?
10. Can it fail gracefully?

Never claim complete if tests were not run.
