# Content strategy — the launch gate is critical mass

## One sentence

We go public only when a new viewer in the launch market cannot run out of series they love
during their first 30 days, and a signed release cadence keeps it that way. (Owner decision,
2026-09-16.)

## Why not "as many titles as the leaders"

| Platform | Library (verified 2026-09-16)                                     |
| -------- | ----------------------------------------------------------------- |
| NetShort | 73,655 series (its own genre index)                               |
| DramaBox | "thousands of titles", about 200 new titles a month (review site) |

With zero owner cash we cannot compete on volume. We compete **per viewer**. In one
language, in the genres that retain, every series in the catalog must be worth finishing,
and the next one must already be there when the viewer finishes.

## The facts the gate is built on

- Viewers watch **25 minutes a day** worldwide (April 2026), about 40 in Southeast Asia.
  ReelShort's US users average **35.7 minutes** a day (Sensor Tower).
- A series is typically 60–100 episodes of 60–120 seconds: **90–150 minutes** in total
  (Filmustage).
- The two revenue leaders made about $140M each in in-app revenue in Q1 2026 (Sensor Tower).
  They build their catalogs on the same few premises:
  - ReelShort: secret billionaires, mafia romance, werewolves, public identity reveals;
  - DramaBox: revenge, comeback, fantasy marriage, billionaire romance (ReelPulse).
- Performance by genre (watch time, completion) is **not published anywhere we could verify**.
  The closed beta measures it.
- Downloads grew 140% year on year to 850M in Q1 2026, 77% of them from Southeast Asia,
  Latin America and India. The free app FreeReels passed 100M installs (Sensor Tower).

## The critical-mass model — an estimate to replace with beta data

Assumptions, each one measured in the closed beta:

1. An engaged viewer watches 35 minutes a day, about 1,050 minutes a month.
2. An average series runs 120 minutes, so that viewer finishes about **9 series a month**.
3. Taste match: a viewer finishes about **1 series in 3** that they start inside the genres
   they like (`series_completion_rate`).
4. A viewer likes **2 of the 3** launch clusters.

The consequence:

- **60 series** (20 per cluster) give a viewer about 40 eligible series and about 13 worth
  finishing. That is about 6 weeks for an engaged viewer and about 2 months for an average
  one (25 min/day).
- To keep month 2 and 3 full, the catalog must grow by **about 20 series a month**. With 12
  a month, engaged viewers run dry in month 2.

### Launch gate

| Gate                                                                   | Minimum | Recommended |
| ---------------------------------------------------------------------- | ------- | ----------- |
| Series at launch, one language                                         | 45      | 60          |
| Series per launch cluster (3 clusters)                                 | 15      | 20          |
| Proven performers (evidence elsewhere, or passed the in-product test)  | 10      | 15          |
| New series signed per month for the first 3 months                     | 12      | 20          |
| Titles passing the technical gate (`scripts/package-episode.mjs`)      | 100%    | 100%        |
| Titles with rights on paper (territories, languages, window, producer) | 100%    | 100%        |

Launch clusters for the English market, taken from what the two revenue leaders build on:
**billionaire/CEO romance**, **revenge & comeback** and **werewolf/supernatural romance**.

### Two stages before the public push

1. **Closed beta**, same catalog, zero ads: 200–500 invited viewers. It measures D1/D7 return,
   `series_completion_rate` and `catalog_exhaustion_rate`. The numbers of the model above
   are replaced with measured ones.
2. **Public push**, only when D7 and exhaustion are inside the targets set from the beta.
   A viral push into an empty catalog burns the one first impression that each viewer
   gives.

### Metrics that decide what to acquire next

| Metric                    | Definition                                                                         | Action                                                              |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `series_completion_rate`  | viewers who reach the last episode / viewers who start episode 1, per series       | below the cluster median in the beta → drop the title from the push |
| `catalog_exhaustion_rate` | weekly viewers who have started every series of their top cluster / weekly viewers | above 10% in a cluster → acquire in that cluster first              |
| `time_to_next_series`     | median time between a series end and the next series start                         | rising → the catalog is thinning                                    |

## Launch market: English

- **Supply.** Licensable English libraries exist, including Western casts that need no
  dubbing (Face Production Media, SeaStar Film).
- **Value per view.** YouTube RPM is $8–20 for US audiences against $0.80–3 for India.
- **Differentiation.** Elsewhere the first 8–10 episodes are free, then coins or subscriptions
  of up to $19.99 a week (TheWrap). "Every episode free, from a link, no install" is the
  sharpest contrast where people pay the most.
- **Trade-off, declared.** The competition is fiercest there. Spanish/Portuguese Latin
  America (23% of downloads) is the second market, localized with revenue.

## Where titles come from with zero owner cash

What is verified about the market:

- Platforms fill their catalogs three ways: their own originals, series commissioned from
  producers to their brief, and licensed titles (L.A. Castle Studios).
- A series costs $150K–$300K to produce (TheWrap).
- The industry itself says that licensing fees at most market rates do not yet justify those
  costs, and that no standard deal framework exists (Vitrina).

First-run premium series go to whoever pays for production. A revenue-share-only distributor
starts from **library titles and producers without distribution**.

| Channel                                             | Why they might say yes                                                                                               | Verified examples                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog licensors with non-exclusive AVOD rights    | A non-exclusive free window is extra income on titles already made; terms negotiated per title                       | Face Production Media: 2,000+ titles, exclusive or non-exclusive per title, AVOD allowed, no minimum order. SeaStar Film: UK talent, AVOD/FAST, "open to offers" |
| Independent vertical producers with finished series | Platforms prefer producers with pipelines ("10 series in development" beats one), so finished orphans need an outlet | To find through producer directories and licensing marketplaces                                                                                                  |
| Emerging producers                                  | Challenger platforms already offer them lower licensing floors (NetShort)                                            | To find                                                                                                                                                          |
| Not approached                                      | Platform-owned originals (ReelShort, DramaBox): competitors                                                          | —                                                                                                                                                                |

What we can give without cash:

- the terms in `docs/business-model.md`: 50% share, non-exclusive, monthly statements to the
  cent;
- public rules for counting minutes (pauses and seeks do not count);
- delivery at our cost;
- social clips of their titles, with permission;
- a feed that does not bury series under ads.

### Declared risk and owner decision points

- If licensors of proven titles require **minimum guarantees** or flat fees, we pass on the
  title. Rejected, because it would change the terms (2026-09-18): guarantees and flat fees
  are money the owner does not have, and the public page promises "no fees, no minimums" on
  both sides. A declined guarantee is a reason to say no to a title, not a pending option.
  What remains open to the owner:
  - a launch-partner uplift of the **share** (still revenue, still no cash up front);
  - a smaller launch with a later public push.
- The quality and rights gates are **never** lowered to reach the numbers.

## Deliverables we ask for each title

1. Vertical masters at 1080×1920 or more, one file per episode.
2. Subtitles (VTT or SRT) in the launch language.
3. Vertical poster art and a synopsis.
4. Episode list and genre/tropes.
5. Rights: territories, languages, license window, producer of record.
6. Performance evidence, when it exists: views, completion, charts.

## Sources

- Sensor Tower, State of Short Drama Apps 2026: https://sensortower.com/blog/state-of-short-drama-apps-2026-report
- NetShort genre index (live count): https://netshort.com/drama/all-plots
- DramaBox review, catalog and cadence: https://shortdramatop.com/apps/dramabox.html
- Series length: https://filmustage.com/blog/how-to-write-a-vertical-drama-script/
- Catalog premises of ReelShort and DramaBox: https://reelpulse.net/guides/short-drama-tropes
- Face Production Media licensing: https://www.faceproduction.net/vertical-micro-drama-licensing
- SeaStar Film licensing: https://seastarfilm.com/licensing-content
- Acquisition pipelines: https://www.lacastlestudios.com/blog/micro-drama-production-companies-guide/
- Production budgets and competitor paywalls: https://www.thewrap.com/vertical-short-dramas-industry-explained-8-billion-business/
- Licensing fees vs production costs, no standard framework: https://vitrina.ai/blog/short-form-content-distribution-2026/
- Producer pipelines, NetShort floors: https://vitrina.ai/blog/micro-drama-distribution-platforms-2026/
- YouTube RPM by country: https://incomefromviews.com/blog/youtube-rpm-by-country/
