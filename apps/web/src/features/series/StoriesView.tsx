"use client";

import type { BrowseSeries } from "@project-flow/feed-domain";
import Link from "next/link";
import { useState, type ReactElement } from "react";

import { BrandMark } from "@/features/platform/BrandMark";
import styles from "@/features/pages/pages.module.css";
import { FOR_STUDIOS_PATH, FREE_FOREVER_LINE } from "@/lib/promise";

import { episodeCountLine } from "./seriesCopy";

/**
 * What exists, by genre. The chips are the Tune sheet's language on a page
 * the viewer chose to open: a filter that does something, not a menu bar.
 *
 * With one title it must read as deliberate, not empty — so it says how many
 * there are, and says plainly that the catalog is being licensed rather than
 * pretending to be a library.
 */
export function StoriesView({
  series,
  genres,
}: {
  series: BrowseSeries[];
  genres: string[];
}): ReactElement {
  const [genre, setGenre] = useState<string | null>(null);
  const shown = genre
    ? series.filter((entry) => entry.genres.includes(genre))
    : series;

  return (
    <main className={styles.root}>
      <div className={styles.column}>
        <header className={styles.head}>
          {/* prefetch off: the feed's JavaScript is paid for by the tap. */}
          <Link className={styles.brandLink} href="/" prefetch={false} aria-label="Watch now">
            <BrandMark className={styles.brand} />
          </Link>
          <p className={styles.eyebrow}>Every story</p>
          <h1 className={styles.title}>
            {series.length === 1 ? "One story, end to end." : "What we have, end to end."}
          </h1>
          <p className={styles.hook}>
            {series.length === 1
              ? "The first title on the shelf. Every episode of it plays now, in order, with nothing to unlock."
              : `${series.length} stories, every episode of each one, in order.`}
          </p>
          <p className={styles.free} data-free-forever="stories">
            {FREE_FOREVER_LINE}
          </p>
        </header>

        {genres.length > 0 ? (
          <section aria-label="Filter by genre">
            <h2 className={styles.sectionTitle}>Genres</h2>
            <ul className={styles.filters}>
              <li>
                <button
                  type="button"
                  className={styles.filter}
                  aria-pressed={genre === null}
                  onClick={() => setGenre(null)}
                  data-genre-filter="all"
                >
                  All
                </button>
              </li>
              {genres.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className={styles.filter}
                    aria-pressed={genre === name}
                    onClick={() => setGenre(genre === name ? null : name)}
                    data-genre-filter={name}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label="Series">
          {shown.length === 0 ? (
            <p className={styles.emptyFilter}>Nothing in that genre yet.</p>
          ) : (
            <ul className={styles.grid} data-series-count={String(shown.length)}>
              {shown.map((entry) => (
                <li key={entry.seriesSlug}>
                  <a className={styles.card} href={entry.href} data-series-card={entry.seriesSlug}>
                    <img
                      className={styles.cardPoster}
                      src={entry.posterUrl}
                      alt=""
                      width={68}
                      height={102}
                      loading="lazy"
                      draggable={false}
                    />
                    <span className={styles.cardText}>
                      <span className={styles.cardTitle}>{entry.title}</span>
                      <span className={styles.cardHook}>{entry.hook}</span>
                      <span className={styles.cardMeta}>
                        {episodeCountLine(entry.episodeCount)}
                        {entry.genres.length > 0 ? (
                          <span className={styles.cardGenres}>
                            {" · "}
                            {entry.genres.join(", ")}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className={styles.foot}>
          <Link className={styles.footLink} href="/" prefetch={false}>
            Watch now
          </Link>
          <a className={styles.footLink} href={FOR_STUDIOS_PATH}>
            For studios
          </a>
        </footer>
      </div>
    </main>
  );
}
