# Vision — PROJECT FLOW

## One sentence

The default destination for vertical serialized entertainment: open the app, and a compelling short drama is already playing.

## Why now

Short-drama apps crossed ~850M global downloads and ~$750M IAP in Q1 2026, with ~25 minutes average daily use by April 2026. Demand is proven. Reviews also show concrete friction: coins, paywalls, ads, and pricing opacity.

We are not creating demand. We are building the product that captures it with less friction and higher perceived quality.

## Product thesis

1. Users open the app and **immediately start watching**.
2. **No mandatory onboarding** before first playback.
3. The **feed** is the default discovery mechanism.
4. The product must feel **premium** even when free / ad-supported.
5. The user must never feel manipulated by coins, dark patterns, or unnecessary friction.
6. Recommendation optimizes for **long-term satisfaction and retention**, not short-term clicks.
7. AI is **infrastructure**, not a gimmick.

## Core loop

```
OPEN APP → VIDEO STARTS → SWIPE → CONTINUE → FOLLOW → RETURN TOMORROW
```

## V0 surfaces (product constraints — not yet implemented)

| ID  | Surface        | Priority                     |
| --- | -------------- | ---------------------------- |
| S1  | Feed           | Dominates the product        |
| S2  | Continue strip | Overlay continuity           |
| S3  | Intent sheet   | Secondary, never blocks feed |

### Explicitly excluded from V0 consumer path

- Login wall before first play
- Coins / fake currency
- Paywall / tutorial overlays
- Chatbot as primary UX
- ML personalization
- Graph database
- Large dashboard/home complexity

These are documented constraints for later prompts. Prompt A does not implement product surfaces.

## Secondary loop (never blocks the feed)

At any point the user may intentionally ask:

- “more romantic”
- “darker”
- “something like this”
- “surprise me”
- “revenge with a female lead”

This intent layer must never obstruct default playback.

## Three sensations (non-negotiable)

| Sensation     | Meaning                                             |
| ------------- | --------------------------------------------------- |
| **FAST**      | First meaningful playback near zero.                |
| **BEAUTIFUL** | Cinematic, minimal, premium — even when free.       |
| **ADDICTIVE** | Continuity is automatic; the next watch is obvious. |

## What we are not

- Not a studio: we never produce. We distribute the best dramas made by others, free forever (`docs/business-model.md`).
- Not “Netflix of short drama” (public positioning).
- Not a coin casino.
- Not a TikTok clone with drama skins.
- Not a feature warehouse.

## Strategic bet

If the first minute is so good the user does not want to leave, we have a serious base to chase retention and scale. Feature count is not the bet. **The first minute is the product.**
