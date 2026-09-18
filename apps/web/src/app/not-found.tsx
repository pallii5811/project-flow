import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/features/platform/BrandMark";
import { getWebFeedCatalog } from "@/lib/feedCatalog";
import { notFoundStory } from "@/lib/notFoundStory";

import styles from "./not-found.module.css";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This link has moved or expired.",
  robots: { index: false, follow: false },
};

/**
 * Every unknown URL lands here: an expired shared link, a typo, a removed
 * episode. It says so plainly and hands the visitor a story to watch now,
 * with one tap (UX-10).
 */
export default function NotFound() {
  const story = notFoundStory(getWebFeedCatalog());
  return (
    <main className={styles.root}>
      <div className={styles.column}>
        <BrandMark className={styles.brand} />
        <div className={styles.message}>
          <p className={styles.kicker}>Page not found</p>
          <h1 className={styles.title}>This link has moved or expired.</h1>
          <p className={styles.body}>Nothing plays here, but a story is ready for you.</p>
        </div>
        {story ? (
          <Link href={story.href} className={styles.card} data-not-found-story="true">
            <img
              className={styles.poster}
              src={story.posterUrl}
              alt=""
              draggable={false}
            />
            <span className={styles.cardText}>
              <span className={styles.cardLabel}>Watch now</span>
              <span className={styles.cardTitle}>{story.seriesTitle}</span>
              <span className={styles.cardHook}>{story.hook}</span>
              <span className={styles.cardMeta}>{story.episodeLabel}</span>
            </span>
            <span className={styles.play} aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
                focusable="false"
              >
                <path d="M8.5 5.8v12.4L19 12 8.5 5.8z" />
              </svg>
            </span>
          </Link>
        ) : (
          <Link href="/" className={styles.button} data-not-found-story="true">
            Watch something now
          </Link>
        )}
      </div>
    </main>
  );
}
