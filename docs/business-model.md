# Business model — a distributor, free forever

## One sentence

PROJECT FLOW distributes the best vertical short dramas **made by others**, free for every
viewer, funded by sponsors, shop-the-scene commissions and a light ad load capped by the
Ad Charter ([`docs/standard.md`](standard.md)).

## Owner decisions (2026-09-16)

1. **Distributor only.** We never produce. We license, curate, localize and distribute.
2. **Free forever for the viewer.** No coins, no paid episodes, no required subscription,
   no unlock mechanics of any kind.
3. **Non-invasive monetization at a very high standard.** The Ad Charter is law.
4. **Zero owner cash.** The owner never funds the product from personal money. Every cost
   must start inside a free tier that allows commercial use and grow only with usage — and
   therefore with ad inventory.

## Precedents (verified 2026-09-16)

| Precedent           | What it proves                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hongguo (ByteDance) | Free short drama at massive scale: 304M monthly users in Feb 2026 (QuestMobile). Revenue comes mainly from ads, and part of it is shared with rights holders. 400+ copyright partners by late 2024, exclusivity not required. Ad revenue about 20B yuan (~$2.9B) in 2025. |
| Tubi (Fox)          | Free, ad-supported, third-party catalog: over $1.1B revenue in FY2025, over 100M monthly users, first profitable quarter July–September 2025, 4–6 minutes of ads per viewing hour.                                                                                        |
| YouTube Shorts      | Creators keep 45% of the ad revenue allocated to them — the market reference for a creator share.                                                                                                                                                                         |

## Revenue streams, from least to most intrusive

1. **Series sponsor.** One brand presents a series in one market ("Presented by …"): a card
   of at most 3 seconds when the series starts in a session. Always disclosed. Counts toward
   the hourly ad cap.
2. **Shop the scene.** Products visible in a scene can be bought from a surface the viewer
   opens by pausing or tapping. It never opens by itself and never covers playing video.
   Precedent: Hongguo's "search for the same style" e-commerce.
3. **Ad breaks between episodes**, strictly inside the Ad Charter: nothing in the first 10
   watched minutes of a session, only at an episode boundary, at most 30 seconds per break
   and 3 minutes per viewing hour.

Targeting is **contextual only** (series, genre, language, country). No personal profiling,
no sale of viewer data.

## Permanently excluded

- Coins, virtual currency, pay-per-episode, subscriptions required to watch.
- "Watch an ad to unlock", tasks to unlock, or any gating of episodes.
- Cash or rewards for watching (Hongguo does this; we never will).
- Ads before the first episode, in the middle of an episode, pop-ups, ads that unmute.
- A paid tier that takes anything away from free viewers.

## Producers (supply side)

| Term               | Default                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Revenue share      | **50%** of the ad and sponsor revenue of a market, split pro-rata to verified watched minutes per series per month        |
| Exclusivity        | None                                                                                                                      |
| Window             | "Second life": series that already earned on paid apps return here free. First-run titles welcome when the producer wants |
| Localization       | Subtitles and dubbing paid from revenue, never from owner cash. At launch we use the languages the producer already has   |
| Reporting          | Monthly statement per series: watched minutes, markets, revenue, share. Totals must tie out to the cent                   |
| Minimum guarantees | None while there is no revenue. Later only from accumulated revenue, only for proven titles                               |

Watched minutes are computed by `computeWatchedMinutes` and statements by
`buildProducerStatement` in `packages/feed-domain/src/partners/`.

### Curation gate — quality comes from what we refuse

A series enters the catalog only if all of these hold:

1. **Rights on paper:** territories, languages, window start and end, producer of record.
2. **Technical master:** vertical 9:16, at least 1080×1920, clean dialogue audio, subtitles.
3. **Proven:** measured performance elsewhere, or it passes the in-product test — the first
   episodes go to a sample of viewers, and the series stays only if episode-1 completion and
   next-episode rate beat the catalog median. Thresholds are set from real data once it
   exists; they are never invented in advance.

## Unit economics — an estimate, to be replaced by measured data

Assumptions (each one is a number to verify in production):

- An active viewer watches 25 minutes a day, about 750 minutes a month.
- Ad load at the Charter cap: 3 ad-minutes per viewing hour.
- Revenue per ad-minute benchmarked on Tubi: about $0.09 per viewing hour with 4–6 ad-minutes,
  so about $0.018 per ad-minute. **Probably optimistic on phones**: Tubi sells TV-screen ads.
- Emerging markets earn about 10× less per view (YouTube RPM: US $8–20 against India
  $0.80–3 per 1,000 views).
- Video weighs about 15 MB per watched minute (about 2 Mbps), 2-second HLS segments.

Per active viewer per month:

| Line                                                    | Rich market | Emerging market |
| ------------------------------------------------------- | ----------- | --------------- |
| Ad revenue                                              | $0.68       | $0.07           |
| Producers (50%)                                         | −$0.34      | −$0.03          |
| Delivery on R2, worst case (every request misses cache) | −$0.01      | −$0.01          |
| **Left for the platform**                               | **+$0.33**  | **+$0.03**      |

Delivery options that were rejected, same viewer:

| Option                                  | Cost per viewer per month | Why rejected                 |
| --------------------------------------- | ------------------------- | ---------------------------- |
| Cloudflare Stream, $1 per 1,000 minutes | $0.75                     | Loses money on every viewer  |
| Bunny Stream, from $0.005 per GB        | $0.06                     | Emerging markets go negative |

The R2 line: zero egress, Class B reads at $0.36 per million beyond 10 million free per
month. Worst case 800 requests a day per viewer, so about 24,000 a month, so about $0.009.
Storage for one series of about 100 minutes in four renditions is about 6 GB, so about $0.09
a month.

**The rule this table creates:** video is always delivered from zero-egress storage. A
per-minute or per-GB delivery bill turns a free product into a loss.

## Zero-owner-cash operating rules

1. Every service starts on a free tier that permits commercial use. Upgrade only when usage
   — and so revenue — requires it.
2. Chosen stack (limits verified 2026-09-16):
   - **Cloudflare Pages** for the static site: Free plan, 500 builds a month, 25 MiB per
     file, 20,000 files.
   - **Cloudflare R2** for video: 10 GB-month, 1M Class A and 10M Class B operations a month
     free, egress free, then $0.015 per GB-month. Cloudflare's terms allow serving video
     through its network when it is hosted on R2, Stream or Images.
   - **Cloudflare Workers + D1** for event collection: Workers Free 100,000 requests a day
     (Paid: $5 a month including 10M), D1 Free 5M rows read and 100,000 rows written a day,
     5 GB.
3. Costs the owner must know before they happen:
   - A domain, about €10 a year: R2 production delivery needs a custom domain, and r2.dev is
     rate-limited and meant for development only.
   - Past the free tiers, Workers Paid at $5 a month.
   - Ad revenue is paid with a delay, typically the following month, so the first
     infrastructure bills arrive before the first ad payment.
   - Receiving ad revenue and paying producers needs a legal and tax setup. Settle it with an
     accountant before the first euro comes in.

## Phases, gated by money and measurement

1. **Foundations (€0):** git, correct share previews, Ad Charter in code, watched-minute
   statements, static deploy readiness, adaptive video pipeline.
2. **Soft launch (€0 on free tiers):** 3–5 licensed second-life series, **zero ads**. Measure
   D1/D7 return, episode completion and next-episode rate.
3. **Monetization, rich market first:** first series sponsor, Charter-capped ad breaks, first
   producer statements.
4. **Expansion funded only by revenue:** localization, emerging markets, shop the scene.

## Sources

- Hongguo model and partners: https://en.wikipedia.org/wiki/Hongguo_(brand)
- Hongguo ad revenue and e-commerce: https://finance.biggo.com/news/fhQO3Z0BDXrLZJaAJDv9
- Tubi FY2025 revenue and users: https://www.thewrap.com/fox-corporation-earnings-q4-2025/
- Tubi viewing time: https://www.foxcorporation.com/news/business/2025/tubi-achieves-record-audience-scale-and-engagement/
- Tubi profitability: https://thedesk.net/2025/10/fox-tubi-now-profitable/
- Tubi ad load: https://tinuiti.com/blog/ott-ads/tubi-advertising/
- YouTube Shorts revenue share: https://support.google.com/youtube/answer/12504220
- YouTube RPM by country: https://incomefromviews.com/blog/youtube-rpm-by-country/
- Cloudflare Stream pricing: https://developers.cloudflare.com/stream/pricing/
- Bunny Stream pricing: https://bunny.net/pricing/stream/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare CDN terms and video: https://www.cloudflare.com/service-specific-terms-application-services/ and https://blog.cloudflare.com/updated-tos/
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare Workers and D1 pricing: https://developers.cloudflare.com/workers/platform/pricing/
