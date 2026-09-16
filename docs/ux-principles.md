# UX principles

## First second test

The first screen must make sense without explanation. Within one second the user should understand: **“this is something I can watch now.”**

Do not create onboarding flows unless evidence shows they improve activation.

## Design direction

- Cinematic, minimal, premium
- Dark-first, with intentional light mode
- Full-screen media (when product surfaces arrive)
- Large, legible typography from the design-system scale
- Extremely sparse controls
- Subtle motion with a job
- No visual clutter, neon glow, or generic AI gradients
- No dashboard-looking consumer screens
- No TikTok/Netflix clone aesthetics

## Semantic token philosophy

Prefer semantic names (`colors.foregroundMuted`, `spacing.md`) over raw hex/px in product code.

- **Color:** hierarchy via contrast/opacity; one restrained accent.
- **Type:** system fonts; localization-safe line heights; Dynamic Type via variants.
- **Spacing:** 4pt scale (`xs`…`4xl`); screen margins from `layout.screenMargin`.
- **Radii:** intentional; default to fewer containers, often `none` on media.
- **Motion:** `instant|fast|normal|deliberate`; respect reduced motion.
- **Elevation:** sparse; composition first, shadows last.
- **Overlays:** `GradientOverlay` scrims for future video readability — primitives only.

## Component boundaries

`packages/ui` may contain: Box, Stack, Row, Text, Icon, Pressable, Divider, Spacer, Surface, GradientOverlay, SafeArea, Screen, ThemeProvider.

**Not yet designed / forbidden until later prompts:** FeedCard, DramaCard, SeriesCard, VideoPlayer, RecommendationCard, SearchSheet, ProfileScreen, navigation chrome, coins/paywall UI.

## Feed first (product — later)

The feed remains the visual center of gravity for the product. Design-system work must enable the feed without implementing it here.

## Interaction rules

- Edge-to-edge video is the eventual default surface.
- Controls appear only when needed.
- Thumb zone: primary actions in the lower third / right rail.
- No modal interruptions during first-use playback.
- Continuity transitions: perceived < 1s.

## Accessibility rules

- Minimum touch target: `layout.minTouchTarget` (44).
- Never encode meaning with color alone.
- Provide accessibility labels on icon-only controls.
- Honor reduced motion (prefer instant/crossfade).
- Support Dynamic Type via typography tokens, not hard-coded one-off sizes.
- Layout must tolerate long translations.

## Hostile critique checklist (per screen)

1. What does the user think this screen is for?
2. What is the primary action?
3. Can the user understand it in <1 second?
4. What can be removed?
5. What is visually distracting?
6. Where could the user hesitate?
7. What feels cheap?
8. What feels slow?
9. What feels manipulative?
10. What makes the experience memorable?

Fix only the top 3 issues before re-evaluating.
