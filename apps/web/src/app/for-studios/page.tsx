import type { Metadata } from "next";
import Link from "next/link";

import { AD_CHARTER } from "@project-flow/feed-domain";

import { BrandMark } from "@/features/platform/BrandMark";
import styles from "@/features/pages/pages.module.css";
import { BRAND_NAME } from "@/lib/brand";
import { BROWSE_PATH, FOR_STUDIOS_PATH, FREE_FOREVER_LINE } from "@/lib/promise";
import { plainPageMetadata } from "@/lib/siteMetadata";

/**
 * The page the owner links in an outreach email (docs/partners/outreach-email.md).
 * It says the same things as docs/partners/producer-terms.html — the terms we
 * already wrote — in the product's own room, so a studio sees what their title
 * would live in.
 *
 * Two rules govern every word on it:
 *
 * 1. **No audience number, ever.** None exists. Nothing here is a forecast, a
 *    projection or a "we expect": the numbers on this page are limits enforced
 *    in code (AD_CHARTER, read straight from the module the player obeys) and
 *    facts about the pipeline that a test proves.
 * 2. **The state of the product is said first, not last.** Closed beta, one
 *    stand-in pack for content, no statement ever issued. A studio that finds
 *    that out later is a studio we lost twice.
 */
export const metadata: Metadata = plainPageMetadata(
  "For studios",
  `Every episode free to watch, every minute paid. Non-exclusive, 50% of ad and sponsor revenue, split by verified minutes watched. ${BRAND_NAME} is in closed beta.`,
  FOR_STUDIOS_PATH,
);

const MINUTES = [
  ["Playing", "Counts in full."],
  ["Paused", "Earns nothing, however long the pause."],
  ["Skipping ahead", "Earns only the real time that passed, not the distance jumped."],
  ["Rewinding", "Earns again only once playback moves forward."],
  ["Resuming later", "Paid from the point of resumption, not from the start."],
  ["Network retries", "A report sent twice is counted once."],
] as const;

const TERMS = [
  [
    "Revenue share",
    "50% of the ad and sponsor revenue of each market, split across series by verified minutes watched, every month.",
  ],
  ["Exclusivity", "None. Keep selling your titles anywhere else."],
  ["Rights", "Yours. We license a free, ad-supported window, nothing more."],
  [
    "Territories and windows",
    "Set by you, per title. They travel with the title in our catalog and the site refuses to list it outside its window — the check runs at every build. Subtitles are published only in the languages you license. The site cannot yet restrict viewing by country, so we can list only titles licensed worldwide.",
  ],
  ["Fees and minimums", "None on either side. One title or a full catalogue."],
  ["Statements", "Monthly, per series and market. Totals tie out to the cent."],
  [
    "Withdrawing",
    "On notice. Tell us and the title comes out at the next publish; the licence is a window, not a lock-in.",
  ],
] as const;

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)} min`;
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1_000)} s`;
}

export default function ForStudiosPage() {
  return (
    <main className={styles.root}>
      <div className={styles.column}>
        <header className={styles.head}>
          {/* prefetch off: a studio reading this has not asked for the feed. */}
          <Link className={styles.brandLink} href="/" prefetch={false} aria-label="Watch now">
            <BrandMark className={styles.brand} />
          </Link>
          <p className={styles.eyebrow}>For producers and licensors of vertical drama</p>
          <h1 className={styles.title}>
            Every episode free to watch. Every minute paid to you.
          </h1>
          <p className={styles.lede}>
            {BRAND_NAME} is a free, ad-light home for vertical dramas made by others. We
            never produce. Viewers never pay, unlock or collect coins — and half of what
            your minutes earn is yours.
          </p>
          <ul className={styles.dealline} aria-label="The deal in one line">
            <li className={styles.deal}>50% of revenue</li>
            <li className={styles.deal}>Non-exclusive</li>
            <li className={styles.deal}>No fees, no minimums</li>
            <li className={styles.deal}>Paid by the minute watched</li>
          </ul>
        </header>

        {/* First, not last: what this is today. */}
        <section className={styles.standing} aria-labelledby="standing-title">
          <p className={styles.eyebrow}>Where we stand today</p>
          <h2 id="standing-title" className={styles.sectionHeading}>
            Closed beta, and saying so
          </h2>
          <p className={styles.prose} data-honest-state="true">
            We have <b>no audience numbers to show</b>, and we will not invent any. The site
            is in closed beta and the only thing playing on it is a <b>stand-in pack we
            generated ourselves</b> — not licensed drama — while the first titles are being
            licensed. The player, the technical check your masters go through, the minute
            counting and the statement arithmetic are built and tested; the collector that
            will feed the statements is not live, so <b>no statement has ever been issued</b>.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="terms-title">
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>The terms</p>
            <h2 id="terms-title" className={styles.sectionHeading}>
              What you get, title by title
            </h2>
          </div>
          <div className={styles.terms}>
            {TERMS.map(([name, body]) => (
              <div key={name} className={styles.term}>
                <p className={styles.termName}>{name}</p>
                <p className={styles.termBody}>{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="minutes-title">
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>How minutes are counted</p>
            <h2 id="minutes-title" className={styles.sectionHeading}>
              Only minutes that were really watched
            </h2>
            <p className={styles.prose}>
              The player reports its position every few seconds. Watched time is rebuilt
              from those reports with fixed rules, written as code and covered by tests. We
              can walk you through them line by line.
            </p>
          </div>
          <ul className={styles.rules}>
            {MINUTES.map(([kind, rule]) => (
              <li key={kind} className={styles.rule}>
                <b>{kind}</b>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="charter-title">
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>Why viewers stay longer</p>
            <h2 id="charter-title" className={styles.sectionHeading}>
              Ads are capped by a written charter
            </h2>
            <p className={styles.prose}>
              More minutes for your series come from viewers who are not pushed away. These
              limits are enforced by the code that decides every break, not left to
              judgment, and changing one of them takes a decision written down in the
              repository.
            </p>
          </div>
          {/* Read from the module the player obeys: these cannot drift. */}
          <ul className={styles.charter}>
            <li className={styles.charterCell} data-charter="grace">
              <span className={styles.charterNumber}>
                {minutes(AD_CHARTER.sessionGraceWatchedMs)}
              </span>
              <span className={styles.charterText}>
                free of any ad at the start of every session
              </span>
            </li>
            <li className={styles.charterCell} data-charter="break">
              <span className={styles.charterNumber}>{seconds(AD_CHARTER.maxAdBreakMs)}</span>
              <span className={styles.charterText}>
                longest break, and only between episodes
              </span>
            </li>
            <li className={styles.charterCell} data-charter="hour">
              <span className={styles.charterNumber}>
                {minutes(AD_CHARTER.maxAdMsPerViewingHour)}
              </span>
              <span className={styles.charterText}>
                most ad time in any hour of viewing
              </span>
            </li>
            <li className={styles.charterCell} data-charter="locked">
              <span className={styles.charterNumber}>0</span>
              <span className={styles.charterText}>
                episodes locked behind ads, coins or tasks
              </span>
            </li>
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="fit-title">
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>Fit</p>
            <h2 id="fit-title" className={styles.sectionHeading}>
              What we look for, and what we ask for
            </h2>
          </div>
          <ul className={styles.rules}>
            <li className={styles.rule}>
              <b>Titles</b>
              <span>
                Completed English-language series, typically 60–100 episodes. Billionaire and
                CEO romance, revenge and comeback, werewolf and supernatural romance. Library
                titles welcome: a second life for series that already earned elsewhere.
              </span>
            </li>
            <li className={styles.rule}>
              <b>Per title</b>
              <span>
                Vertical masters at 1080×1920 or higher, one file per episode. Subtitles in
                VTT or SRT. Poster art, synopsis, episode list, genre and tropes. Rights:
                territories, languages, window, producer of record.
              </span>
            </li>
            <li className={styles.rule}>
              <b>On us</b>
              <span>
                Encoding for every network in 2-second segments, never upscaled past your
                master; every episode normalised to −16 LUFS and measured on the file we
                serve; delivery at our cost, from a link that plays with no install and no
                sign-up; statements you can check line by line.
              </span>
            </li>
            <li className={styles.rule}>
              <b>Social clips</b>
              <span>
                Only with your written yes, recorded per title. It is no unless you say
                otherwise, and a title without that permission is refused by name before
                anything is cut.
              </span>
            </li>
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="next-title">
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>Next</p>
            <h2 id="next-title" className={styles.sectionHeading}>
              Send a title list
            </h2>
            <p className={styles.prose}>
              Reply to the email that brought you here with your titles, and we answer with
              a proposal title by title. There is nothing to sign to talk, and nothing on
              this page is a contract: terms are agreed in writing, per title.
            </p>
          </div>
          <p className={styles.free} data-free-forever="for_studios">
            {FREE_FOREVER_LINE}
          </p>
        </section>

        <footer className={styles.foot}>
          <Link className={styles.footLink} href="/" prefetch={false}>
            Watch now
          </Link>
          <a className={styles.footLink} href={BROWSE_PATH}>
            See every story
          </a>
        </footer>
      </div>
    </main>
  );
}
