"use client";

import {
  createLocalStorageRetentionStore,
  emptyRetentionState,
  followedSeriesIds,
  toggleFollow,
  watchedContentIds,
  type RetentionState,
  type SeriesPageData,
} from "@project-flow/feed-domain";
import type { AnalyticsEventName, AnalyticsProperties } from "@project-flow/analytics";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { BrandMark } from "@/features/platform/BrandMark";
import { BROWSE_PATH, FREE_FOREVER_LINE, seriesPath } from "@/lib/promise";
import { shareOrigin } from "@/lib/siteUrl";

/**
 * The analytics client and the resume store are part of the feed's first
 * load. Imported statically here, they were shared between two routes and
 * webpack split them into a chunk of their own that the FEED then had to
 * fetch before its first frame: one more request, measured at +69 ms median
 * on the throttled phone profile (docs/decisions.md, batch 8). This page needs
 * them only after it is on screen, so it asks for them then.
 */
function track(name: AnalyticsEventName, properties: AnalyticsProperties): void {
  void import("@/lib/analytics")
    .then(({ getAnalyticsClient }) => getAnalyticsClient().track(name, properties))
    .catch(() => undefined);
}

import {
  continueLabel,
  continuePoint,
  episodeCountLine,
  episodeLength,
  runtimeLine,
  type ContinuePoint,
} from "./seriesCopy";
import styles from "@/features/pages/pages.module.css";

/**
 * The page about one series: what this is, how much of it there is, where the
 * viewer had got to, and one tap into the picture. It is the page a clip
 * viewer opens when they want to know what they are watching.
 *
 * Everything static is in the HTML the build wrote; only what belongs to this
 * device — where they left off, what they watched, whether they follow — is
 * filled in after mount, so the page is complete and readable before any
 * script runs.
 */
export function SeriesView({ data }: { data: SeriesPageData }): ReactElement {
  const analytics = useMemo(() => getAnalyticsClient(), []);
  const retentionStore = useMemo(() => createLocalStorageRetentionStore(), []);
  const [retention, setRetention] = useState<RetentionState>(emptyRetentionState);
  const retentionRef = useRef(retention);
  retentionRef.current = retention;
  const [resume, setResume] = useState<ContinuePoint | null>(null);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);

  const following = followedSeriesIds(retention).has(data.seriesId);
  const watched = useMemo(() => watchedContentIds(retention), [retention]);
  const runtime = runtimeLine(data.totalDurationMs);
  const firstEpisode = data.episodes[0];

  useEffect(() => {
    setRetention(retentionStore.load());
  }, [retentionStore]);

  useEffect(() => {
    analytics.track("series_page_view", {
      series_id: data.seriesId,
      episode_count: data.episodes.length,
    });
  }, [analytics, data.episodes.length, data.seriesId]);

  // Where this device left the story. The resume store keeps one point per
  // series (VIR-2), which is exactly what this page needs.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await createLocalStorageResumeStore().loadForSeries(data.seriesId);
      if (cancelled) return;
      setResume(continuePoint(saved, data.episodes));
    })();
    return () => {
      cancelled = true;
    };
  }, [data.episodes, data.seriesId]);

  const onFollow = useCallback(() => {
    const next = toggleFollow(
      retentionRef.current,
      {
        seriesId: data.seriesId,
        seriesSlug: data.seriesSlug,
        // This page knows exactly what the series has: every episode that
        // plays is listed on it.
        episodeCount: data.episodes.length,
      },
      Date.now(),
    );
    retentionRef.current = next;
    retentionStore.save(next);
    setRetention(next);
    analytics.track("follow", {
      series_id: data.seriesId,
      content_id: null,
      following: !following,
      episode_count: data.episodes.length,
    });
  }, [analytics, data, following, retentionStore]);

  const onShare = useCallback(() => {
    const origin = shareOrigin(
      process.env.NEXT_PUBLIC_SITE_URL,
      typeof window === "undefined" ? "" : window.location.origin,
    );
    const url = `${origin}${seriesPath(data.seriesSlug)}?utm_source=share&utm_medium=social`;
    analytics.track("share_open", {
      series_id: data.seriesId,
      content_id: null,
      source: "series_page",
    });
    void (async () => {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
          await navigator.share({ title: data.title, text: data.hook, url });
          return;
        } catch (error) {
          // Closing the sheet is a choice: nothing is copied behind it (VIR-3).
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      try {
        if (typeof navigator === "undefined" || !navigator.clipboard) {
          throw new Error("clipboard unavailable");
        }
        await navigator.clipboard.writeText(url);
        setCopied("copied");
      } catch {
        setCopied("failed");
      }
    })();
  }, [analytics, data]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const continueHref = resume
    ? (data.episodes.find((episode) => episode.episodeNumber === resume.episodeNumber)
        ?.href ?? null)
    : null;

  return (
    <main className={styles.root}>
      <div className={styles.column}>
        <header className={styles.head}>
          {/*
           * prefetch off on purpose: the feed's JavaScript is the heaviest
           * thing on the site, and a viewer reading this page has not asked
           * for it yet. The tap pays for it, nobody else does.
           */}
          <Link className={styles.brandLink} href="/" prefetch={false} aria-label="Watch now">
            <BrandMark className={styles.brand} />
          </Link>

          <p className={styles.eyebrow}>Series</p>
          <h1 className={styles.title}>{data.title}</h1>
          <p className={styles.hook}>{data.hook}</p>

          <p className={styles.meta} data-series-meta="true">
            <span>{episodeCountLine(data.episodes.length)}</span>
            {runtime ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{runtime}</span>
              </>
            ) : null}
          </p>

          {data.genres.length > 0 ? (
            <ul className={styles.genres} aria-label="Genres">
              {data.genres.map((genre) => (
                <li key={genre} className={styles.genre}>
                  {genre}
                </li>
              ))}
            </ul>
          ) : null}

          {/* Said once on this page, where a viewer decides whether to start. */}
          <p className={styles.free} data-free-forever="series_page">
            {FREE_FOREVER_LINE}
          </p>

          <div className={styles.actions}>
            {continueHref && resume ? (
              <a
                className={styles.primary}
                href={continueHref}
                data-series-continue={String(resume.episodeNumber)}
              >
                {continueLabel(resume)}
              </a>
            ) : null}
            {firstEpisode ? (
              <a
                className={continueHref ? styles.secondary : styles.primary}
                href={firstEpisode.href}
                data-series-start="true"
              >
                Start from episode {firstEpisode.episodeNumber}
              </a>
            ) : null}
          </div>

          <div className={styles.minorActions}>
            <button
              type="button"
              className={styles.minorAction}
              onClick={onFollow}
              aria-pressed={following}
              data-series-follow="true"
            >
              {following ? "Following" : "Follow series"}
            </button>
            <button
              type="button"
              className={styles.minorAction}
              onClick={onShare}
              data-series-share="true"
            >
              Share
            </button>
            <span className={styles.shareResult} role="status" aria-live="polite">
              {copied === "copied" ? "Link copied" : null}
              {copied === "failed" ? "Couldn’t copy the link" : null}
            </span>
          </div>
        </header>

        <section className={styles.episodes} aria-labelledby="episodes-title">
          <h2 id="episodes-title" className={styles.sectionTitle}>
            Episodes
          </h2>
          <ol className={styles.list}>
            {data.episodes.map((episode) => {
              const seen = watched.has(episode.contentId);
              const length = episodeLength(episode.durationMs);
              return (
                <li key={episode.contentId}>
                  <a
                    className={styles.episode}
                    href={episode.href}
                    data-episode={String(episode.episodeNumber)}
                    data-watched={seen ? "true" : undefined}
                  >
                    <img
                      className={styles.poster}
                      src={episode.posterUrl}
                      alt=""
                      width={48}
                      height={72}
                      loading="lazy"
                      draggable={false}
                    />
                    <span className={styles.episodeText}>
                      <span className={styles.episodeKicker}>
                        Episode {episode.episodeNumber}
                        {length ? ` · ${length}` : ""}
                      </span>
                      <span className={styles.episodeTitle}>{episode.title}</span>
                      <span className={styles.episodeHook}>{episode.hook}</span>
                    </span>
                    {seen ? (
                      <span className={styles.watched}>
                        <svg
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M5 12.5l4.2 4.2L19 7" />
                        </svg>
                        Watched
                      </span>
                    ) : (
                      <span className={styles.play} aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                          <path d="M8.5 5.8v12.4L19 12 8.5 5.8z" />
                        </svg>
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ol>
        </section>

        <footer className={styles.foot}>
          <a className={styles.footLink} href={BROWSE_PATH} data-browse-link="series_page">
            See every story
          </a>
        </footer>
      </div>
    </main>
  );
}
