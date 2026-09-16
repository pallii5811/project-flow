"use client";

import {
  createCatalogIntentService,
  createDeterministicFeedSource,
  createLocalStorageResumeStore,
  createLocalStorageTasteStore,
  createRecommendationService,
  createWatchProgressThrottle,
  createWebPerfTiming,
  getLaunchFeedCatalog,
  getPrefetchIds,
  isResumable,
  materializeFeedItems,
  resolveNextInSeries,
  shouldPersistResume,
  type ContentItem,
  type IntentChipId,
  type ResumeSnapshot,
} from "@project-flow/feed-domain";
import { createLocalFeatureFlags } from "@project-flow/shared";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import {
  getAnalyticsClient,
  getAnalyticsTransport,
  getAnonymousUserId,
  getSessionId,
} from "@/lib/analytics";
import {
  captureAcquisitionFromLocation,
  createShareId,
  isDiagEnabled,
  loadAcquisitionContext,
} from "@/lib/session";

import { LaunchDiagPanel } from "@/features/diagnostics/LaunchDiagPanel";
import { patchLaunchDiagnostics } from "@/features/diagnostics/launchDiagnostics";

import { ContinueStrip } from "./ContinueStrip";
import { FeedScroller } from "./FeedScroller";
import { FeedStage } from "./FeedStage";
import { IntentSheet } from "./IntentSheet";
import { SeriesEnd } from "./SeriesEnd";
import { buildShareUrl, shouldShowPlayGate } from "./feedLogic";
import styles from "./feed.module.css";

type FeedAppProps = {
  /** Deep-link starting content (watch route). */
  initialContentId?: string;
  deepLinkRoute?: string;
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function FeedApp({
  initialContentId,
  deepLinkRoute,
}: FeedAppProps): ReactElement {
  const analytics = useMemo(() => getAnalyticsClient(), []);
  const sessionId = useMemo(() => getSessionId(), []);
  const anonymousUserId = useMemo(() => getAnonymousUserId(), []);
  const locale =
    typeof navigator !== "undefined" ? navigator.language : "en";
  const flags = useMemo(
    () =>
      createLocalFeatureFlags({
        FEED_V0: true,
        RECOMMENDATION_V0: true,
        RECOMMENDATION_DIVERSITY_V0: true,
        RECOMMENDATION_EXPLORATION_V0: true,
        INTENT_LAYER: true,
        INTENT_CHIPS_V0: true,
      }),
    [],
  );

  const launchCatalog = useMemo(() => getLaunchFeedCatalog(), []);
  const source = useMemo(
    () => createDeterministicFeedSource(launchCatalog),
    [launchCatalog],
  );
  const catalog = useMemo(() => source.loadCatalog(), [source]);
  const editorialItems = useMemo(() => source.getOrderedItems(), [source]);

  const [items, setItems] = useState<ContentItem[]>(editorialItems);
  const [index, setIndex] = useState(() => {
    if (!initialContentId) return 0;
    const found = editorialItems.findIndex((item) => item.id === initialContentId);
    return found >= 0 ? found : 0;
  });

  const [muted, setMuted] = useState(true);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set());
  const [followingIds, setFollowingIds] = useState<Set<string>>(() => new Set());
  const [progressById, setProgressById] = useState<Record<string, number>>({});
  const [seekToMs, setSeekToMs] = useState<number | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [userStartedPlayback, setUserStartedPlayback] = useState(false);
  const [intentOpen, setIntentOpen] = useState(false);
  const [seriesEnded, setSeriesEnded] = useState(false);
  const [resumeOffer, setResumeOffer] = useState<ResumeSnapshot | null>(null);

  const resumeStore = useMemo(() => createLocalStorageResumeStore(), []);
  const progressThrottle = useMemo(() => createWatchProgressThrottle(5_000), []);
  const lastResumeRef = useRef<ResumeSnapshot | null>(null);
  const firstPlayMarked = useRef(false);
  const firstAttemptMarked = useRef(false);
  const openedTracked = useRef(false);
  const deepLinkTracked = useRef(false);
  const contentOpenTracked = useRef<string | null>(null);
  const lastContinueKey = useRef<string | null>(null);
  const sharePlayTracked = useRef(false);
  const indexRef = useRef(index);
  indexRef.current = index;
  const perf = useMemo(() => createWebPerfTiming(), []);
  const playToggleRef = useRef<() => void>(() => undefined);
  const [diagOpen, setDiagOpen] = useState(false);

  const recommendationService = useMemo(
    () =>
      createRecommendationService({
        catalog: editorialItems,
        feedSource: source,
        analytics,
        sessionId,
        store: createLocalStorageTasteStore(),
        enabled: flags.isEnabled("RECOMMENDATION_V0"),
        diversityEnabled: flags.isEnabled("RECOMMENDATION_DIVERSITY_V0"),
        explorationEnabled: flags.isEnabled("RECOMMENDATION_EXPLORATION_V0"),
      }),
    [analytics, editorialItems, flags, sessionId, source],
  );

  const intentService = useMemo(
    () =>
      createCatalogIntentService({
        analytics,
        sessionId,
        catalog: editorialItems,
        nlEnabled: flags.isEnabled("INTENT_NL_V0"),
      }),
    [analytics, editorialItems, flags, sessionId],
  );

  useEffect(() => {
    perf.mark("app_shell_ready");
    patchLaunchDiagnostics({
      pageStartTs: perf.get("page_start"),
      anonymousUserId,
      sessionId,
    });
    if (!openedTracked.current) {
      openedTracked.current = true;
      analytics.track("page_view", {
        session_id: sessionId,
        route:
          typeof window !== "undefined" ? window.location.pathname : "/",
      });
    }
    if (isDiagEnabled()) setDiagOpen(true);
  }, [analytics, anonymousUserId, perf, sessionId]);

  useEffect(() => {
    const acquisition = captureAcquisitionFromLocation();
    if (!initialContentId || deepLinkTracked.current) return;
    deepLinkTracked.current = true;
    const item = editorialItems.find((entry) => entry.id === initialContentId);
    analytics.track("share_landing", {
      route:
        deepLinkRoute ??
        (typeof window !== "undefined" ? window.location.pathname : null),
      series_id: item?.seriesId ?? null,
      episode_id: item?.episodeId ?? null,
      content_id: item?.id ?? null,
      referrer: acquisition.referrer,
      utm_source: acquisition.utmSource,
      share_id: acquisition.shareId,
    });
    if (item) {
      analytics.track("content_open", {
        content_id: item.id,
        series_id: item.seriesId,
        episode_id: item.episodeId,
        source: acquisition.shareId || acquisition.utmSource ? "share" : "deep_link",
      });
      contentOpenTracked.current = item.id;
      patchLaunchDiagnostics({
        contentOpenTs: Date.now(),
        contentId: item.id,
        seriesId: item.seriesId,
        episodeId: item.episodeId,
      });
    }
  }, [
    analytics,
    deepLinkRoute,
    editorialItems,
    initialContentId,
  ]);

  // Resume from localStorage (non-blocking). Deep link preserves resume for same episode.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snapshot = await resumeStore.load();
      if (cancelled || !snapshot) return;
      lastResumeRef.current = snapshot;
      setMuted(snapshot.muted);
      setCaptionsOn(snapshot.captionsOn);

      if (initialContentId) {
        if (
          snapshot.contentId === initialContentId &&
          isResumable(snapshot)
        ) {
          setResumeOffer(snapshot);
          patchLaunchDiagnostics({ resumePositionMs: snapshot.positionMs });
        }
        return;
      }
      if (!isResumable(snapshot)) return;

      const resumeIndex = editorialItems.findIndex(
        (item) => item.id === snapshot.contentId,
      );
      if (resumeIndex < 0) return;
      setIndex(resumeIndex);
      setResumeOffer(snapshot);
      patchLaunchDiagnostics({ resumePositionMs: snapshot.positionMs });
    })();
    return () => {
      cancelled = true;
    };
  }, [editorialItems, initialContentId, resumeStore]);

  // Recommendation refresh AFTER first paint — never block first play.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const activeIndex = indexRef.current;
          const currentItem = items[activeIndex] ?? editorialItems[0] ?? null;
          const result = await recommendationService.getOrderedItems({
            sessionId,
            language: "en",
            limit: 40,
            seed: hashSeed(sessionId),
            now: Date.now(),
            excludeContentIds: currentItem ? [currentItem.id] : [],
            activeContentId: currentItem?.id ?? null,
            activeSeriesId: currentItem?.seriesId ?? null,
            diversityEnabled: true,
            explorationEnabled: true,
          });
          if (cancelled) return;
          const { items: nextItems } = materializeFeedItems(
            result,
            editorialItems,
          );
          if (nextItems.length === 0) return;

          setItems((prev) => {
            const activeId = prev[indexRef.current]?.id;
            if (!activeId) return nextItems;
            const rest = nextItems.filter((item) => item.id !== activeId);
            const active = prev.find((item) => item.id === activeId);
            if (!active) return nextItems;
            return [active, ...rest];
          });
          setIndex(0);
        } catch {
          // Editorial order stays — recommendation must never break feed.
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [recommendationService, sessionId, editorialItems]);

  const current = items[index] ?? null;
  const nextItem = items[index + 1] ?? null;
  const prefetchIds = useMemo(
    () => (items.length > 0 ? getPrefetchIds(items, index) : new Set<string>()),
    [items, index],
  );

  // Warm next episode bytes while current plays (zero-gap swipe).
  useEffect(() => {
    if (!nextItem || typeof document === "undefined") return;
    const videoHref = nextItem.playback.reference;
    const posterHref =
      nextItem.playback.posterReference || nextItem.thumbnailUrl;
    const links: HTMLLinkElement[] = [];

    const add = (rel: string, as: string, href: string, type?: string) => {
      const existing = document.head.querySelector(
        `link[data-flow-prefetch="${href}"]`,
      );
      if (existing) return;
      const link = document.createElement("link");
      link.rel = rel;
      link.as = as;
      link.href = href;
      link.dataset.flowPrefetch = href;
      if (type) link.type = type;
      document.head.appendChild(link);
      links.push(link);
    };

    add("preload", "video", videoHref, "video/mp4");
    add("preload", "image", posterHref);

    return () => {
      for (const link of links) link.remove();
    };
  }, [nextItem]);

  // Open first feed item (non-share) once.
  useEffect(() => {
    if (!current || initialContentId) return;
    if (contentOpenTracked.current === current.id) return;
    contentOpenTracked.current = current.id;
    analytics.track("content_open", {
      content_id: current.id,
      series_id: current.seriesId,
      episode_id: current.episodeId,
      source: "feed",
    });
    analytics.track("content_impression", {
      content_id: current.id,
      series_id: current.seriesId,
    });
    patchLaunchDiagnostics({
      contentOpenTs: Date.now(),
      contentId: current.id,
      seriesId: current.seriesId,
      episodeId: current.episodeId,
    });
  }, [analytics, current, initialContentId]);

  useEffect(() => {
    if (!current) return;
    patchLaunchDiagnostics({
      contentId: current.id,
      seriesId: current.seriesId,
      episodeId: current.episodeId,
      contentStatus: current.status,
      width: current.playback.width,
      height: current.playback.height,
      aspectRatio: current.playback.aspectRatio,
      captionTracks: current.captions.filter((t) => t.status === "ready").length,
      captionsOn,
      sourceUri: current.videoUrl,
      prefetchIds: [...prefetchIds],
      anonymousUserId,
      sessionId,
      pageStartTs: perf.get("page_start"),
      timeToFirstPlayMs: perf.timeToFirstPlay(),
    });
  }, [
    anonymousUserId,
    captionsOn,
    current,
    perf,
    prefetchIds,
    sessionId,
  ]);

  const persistResume = useCallback(
    async (snapshot: ResumeSnapshot) => {
      if (!shouldPersistResume(lastResumeRef.current, snapshot)) return;
      lastResumeRef.current = snapshot;
      await resumeStore.save(snapshot);
    },
    [resumeStore],
  );

  const emitWatchProgress = useCallback(
    (
      item: ContentItem,
      positionMs: number,
      durationMs: number,
      force = false,
    ) => {
      if (force) progressThrottle.forceNext();
      if (
        !force &&
        !progressThrottle.shouldEmit({
          contentId: item.id,
          positionMs,
          durationMs,
        })
      ) {
        return;
      }
      const completion =
        durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0;
      analytics.track("watch_progress", {
        content_id: item.id,
        series_id: item.seriesId,
        episode_id: item.episodeId,
        position_ms: Math.round(positionMs),
        duration_ms: Math.round(durationMs),
        completion_percentage: Math.round(completion),
        session_id: sessionId,
        anonymous_user_id: anonymousUserId,
      });
    },
    [analytics, anonymousUserId, progressThrottle, sessionId],
  );

  const handleIndexChange = useCallback(
    (next: number) => {
      if (next === index) return;
      const from = items[index];
      if (from) {
        const pos = (progressById[from.id] ?? 0) * from.durationMs;
        emitWatchProgress(from, pos, from.durationMs, true);
        analytics.track("episode_leave", {
          content_id: from.id,
          series_id: from.seriesId,
          episode_id: from.episodeId,
          completion_percentage: Math.round((progressById[from.id] ?? 0) * 100),
        });
        const watchedPct = (progressById[from.id] ?? 0) * 100;
        if (watchedPct > 0 && watchedPct < 40) {
          analytics.track("video_skipped", {
            content_id: from.id,
            completion_percentage: Math.round(watchedPct),
          });
        }
      }
      analytics.track("feed_swipe", {
        direction: next > index ? "next" : "previous",
        from_content_id: items[index]?.id ?? null,
        to_content_id: items[next]?.id ?? null,
      });
      const to = items[next];
      if (to && contentOpenTracked.current !== to.id) {
        contentOpenTracked.current = to.id;
        analytics.track("content_open", {
          content_id: to.id,
          series_id: to.seriesId,
          episode_id: to.episodeId,
          source: "feed_swipe",
        });
        analytics.track("content_impression", {
          content_id: to.id,
          series_id: to.seriesId,
        });
      }
      perf.mark("episode_transition_started");
      setSeriesEnded(false);
      setResumeOffer(null);
      setSeekToMs(null);
      setAutoplayBlocked(false);
      progressThrottle.reset();
      setIndex(next);
    },
    [
      analytics,
      emitWatchProgress,
      index,
      items,
      perf,
      progressById,
      progressThrottle,
    ],
  );

  const handleTimeUpdate = useCallback(
    (item: ContentItem, positionMs: number, durationMs: number) => {
      const progress =
        durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
      setProgressById((prev) =>
        prev[item.id] === progress ? prev : { ...prev, [item.id]: progress },
      );
      patchLaunchDiagnostics({
        currentTimeMs: positionMs,
        durationMs,
      });
      emitWatchProgress(item, positionMs, durationMs);
      void persistResume({
        contentId: item.id,
        seriesId: item.seriesId,
        episodeId: item.episodeId,
        positionMs,
        durationMs: durationMs || item.durationMs,
        muted,
        captionsOn,
        updatedAt: Date.now(),
        completed: false,
      });
    },
    [captionsOn, emitWatchProgress, muted, persistResume],
  );

  const handleEnded = useCallback(
    (item: ContentItem) => {
      emitWatchProgress(item, item.durationMs, item.durationMs, true);
      analytics.track("episode_complete", {
        content_id: item.id,
        series_id: item.seriesId,
        episode_id: item.episodeId,
      });
      void persistResume({
        contentId: item.id,
        seriesId: item.seriesId,
        episodeId: item.episodeId,
        positionMs: item.durationMs,
        durationMs: item.durationMs,
        muted,
        captionsOn,
        updatedAt: Date.now(),
        completed: true,
      });
      void recommendationService.recordSignal({
        contentId: item.id,
        seriesId: item.seriesId,
        genres: item.genres,
        tropes: item.tropes,
        language: item.language,
        action: "complete",
        watchDurationMs: item.durationMs,
        completionPercentage: 100,
        now: Date.now(),
      });

      const resolution = resolveNextInSeries(source, items, index);
      if (resolution.kind === "next_in_series") {
        const continueKey = `${item.id}->${resolution.next.id}`;
        if (lastContinueKey.current !== continueKey) {
          lastContinueKey.current = continueKey;
          analytics.track("series_continue", {
            content_id: item.id,
            series_id: item.seriesId,
            next_content_id: resolution.next.id,
            next_episode_id: resolution.next.episodeId,
          });
        }
        perf.mark("episode_transition_started");
        setSeriesEnded(false);
        setSeekToMs(null);
        setIndex(resolution.nextIndex);
        return;
      }
      analytics.track("series_complete", {
        content_id: item.id,
        series_id: item.seriesId,
      });
      setSeriesEnded(true);
    },
    [
      analytics,
      captionsOn,
      emitWatchProgress,
      index,
      items,
      muted,
      perf,
      persistResume,
      recommendationService,
      source,
    ],
  );

  const handleShare = useCallback(
    async (item: ContentItem) => {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const shareId = createShareId();
      const url = buildShareUrl(catalog, item, origin, {
        utmSource: "share",
        utmMedium: "social",
        shareId,
      });
      if (!url) return;
      analytics.track("share_open", {
        content_id: item.id,
        series_id: item.seriesId,
        episode_id: item.episodeId,
        share_id: shareId,
      });
      try {
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          await navigator.share({
            title: item.seriesTitle,
            text: item.hook.replace(/\n/g, " "),
            url,
          });
          analytics.track("share_native", {
            content_id: item.id,
            share_id: shareId,
          });
          return;
        }
      } catch {
        // fall through to clipboard
      }
      try {
        await navigator.clipboard.writeText(url);
        analytics.track("share_copy", {
          content_id: item.id,
          share_id: shareId,
        });
      } catch {
        // share best-effort
      }
    },
    [analytics, catalog],
  );

  const handleIntentChip = useCallback(
    async (chipId: IntentChipId) => {
      const active = items[index];
      const resolution = await intentService.resolveChip(chipId, {
        contentId: active?.id ?? null,
        seriesId: active?.seriesId ?? null,
        genres: active?.genres ?? [],
        tropes: active?.tropes ?? [],
      });
      setIntentOpen(false);

      if (resolution.candidates.length === 0 || !active) return;

      const byId = new Map(editorialItems.map((item) => [item.id, item]));
      const intentItems = resolution.candidates
        .map((candidate) => byId.get(candidate.contentId))
        .filter((entry): entry is ContentItem => Boolean(entry));

      setItems((prev) => {
        const head = prev[index];
        if (!head) return prev;
        const rest = intentItems.filter((item) => item.id !== head.id);
        const leftovers = prev
          .slice(index + 1)
          .filter(
            (item) =>
              item.id !== head.id &&
              !rest.some((candidate) => candidate.id === item.id),
          );
        return [head, ...rest, ...leftovers];
      });
      setIndex(0);
    },
    [editorialItems, index, intentService, items],
  );

  const showGate = shouldShowPlayGate(autoplayBlocked, userStartedPlayback);

  const handlePlayGate = useCallback(() => {
    setUserStartedPlayback(true);
    setAutoplayBlocked(false);
    analytics.track("first_play_attempted", {
      session_id: sessionId,
      content_id: items[index]?.id ?? null,
      source: "play_gate",
    });
    const video = document.querySelector<HTMLVideoElement>(
      `[data-content-id="${items[index]?.id ?? ""}"] video`,
    );
    if (video) {
      void video.play().catch(() => undefined);
    }
  }, [analytics, index, items, sessionId]);

  playToggleRef.current = () => {
    const video = document.querySelector<HTMLVideoElement>(
      `[data-content-id="${items[index]?.id ?? ""}"] video`,
    );
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => setAutoplayBlocked(true));
    } else {
      video.pause();
    }
  };

  if (items.length === 0) {
    return (
      <main className={styles.root}>
        <FeedStage>
          <p className={styles.empty}>Finding something great…</p>
        </FeedStage>
      </main>
    );
  }

  return (
    <main className={styles.root}>
      <FeedStage>
        <FeedScroller
          items={items}
          index={index}
          onIndexChange={handleIndexChange}
          muted={muted}
          captionsOn={captionsOn}
          likedIds={likedIds}
          followingIds={followingIds}
          progressById={progressById}
          seekToMs={seekToMs}
          showPlayGate={showGate}
          prefetchIds={prefetchIds}
          locale={locale}
          onToggleMute={() => setMuted((value) => !value)}
          onUnmute={() => setMuted(false)}
          onToggleCaptions={() => {
            setCaptionsOn((value) => {
              const next = !value;
              analytics.track("caption_toggled", {
                session_id: sessionId,
                captions_on: next,
                content_id: current?.id ?? null,
              });
              return next;
            });
          }}
          onTogglePlayPause={() => playToggleRef.current()}
          onPlayGate={handlePlayGate}
          onLike={(item) => {
            setLikedIds((prev) => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              return next;
            });
            analytics.track("like", {
              content_id: item.id,
              series_id: item.seriesId,
            });
            void recommendationService.recordSignal({
              contentId: item.id,
              seriesId: item.seriesId,
              genres: item.genres,
              tropes: item.tropes,
              language: item.language,
              action: "like",
              watchDurationMs: 0,
              completionPercentage: 0,
              now: Date.now(),
            });
          }}
          onFollow={(item) => {
            setFollowingIds((prev) => {
              const next = new Set(prev);
              if (next.has(item.seriesId)) next.delete(item.seriesId);
              else next.add(item.seriesId);
              return next;
            });
            analytics.track("follow", {
              content_id: item.id,
              series_id: item.seriesId,
            });
            void recommendationService.recordSignal({
              contentId: item.id,
              seriesId: item.seriesId,
              genres: item.genres,
              tropes: item.tropes,
              language: item.language,
              action: "follow",
              watchDurationMs: 0,
              completionPercentage: 0,
              now: Date.now(),
            });
          }}
          onShare={(item) => {
            void handleShare(item);
          }}
          onTune={() => {
            if (!flags.isEnabled("INTENT_LAYER")) return;
            analytics.track("intent_open", { session_id: sessionId });
            setIntentOpen(true);
          }}
          onMetadataReady={(item) => {
            if (item.id !== current?.id) return;
            perf.mark("content_metadata_ready");
          }}
          onPosterVisible={(item) => {
            if (item.id !== current?.id) return;
            perf.mark("poster_visible");
          }}
          onLoadStart={(item) => {
            if (item.id !== current?.id) return;
            perf.mark("video_load_started");
          }}
          onCanPlay={(item) => {
            if (item.id !== current?.id) return;
            perf.mark("video_can_play");
            analytics.track("video_ready", {
              session_id: sessionId,
              content_id: item.id,
            });
          }}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onError={(item, code, reason) => {
            analytics.track("playback_error", {
              session_id: sessionId,
              content_id: item.id,
              series_id: item.seriesId,
              episode_id: item.episodeId,
              error_code: code,
              reason,
            });
            if (index < items.length - 1) {
              setIndex(index + 1);
            }
          }}
          onPlayAttempt={(item) => {
            patchLaunchDiagnostics({
              autoplayAttempted: true,
              playAttemptTs: Date.now(),
              playerState: "loading",
            });
            if (firstAttemptMarked.current) return;
            firstAttemptMarked.current = true;
            analytics.track("first_play_attempted", {
              content_id: item.id,
              source: "autoplay",
            });
          }}
          onFirstFrameProxy={(item) => {
            if (item.id !== current?.id) return;
            perf.mark("episode_first_frame_played");
          }}
          onPlay={(item) => {
            setAutoplayBlocked(false);
            setUserStartedPlayback(true);
            patchLaunchDiagnostics({
              playerState: "playing",
              autoplayBlocked: false,
              contentId: item.id,
              seriesId: item.seriesId,
              episodeId: item.episodeId,
              sourceUri: item.videoUrl,
            });
            if (!firstPlayMarked.current) {
              firstPlayMarked.current = true;
              perf.mark("video_play_started");
              perf.mark("first_meaningful_play");
              const ttfp = perf.timeToFirstPlay();
              patchLaunchDiagnostics({
                firstMeaningfulPlayTs: perf.get("first_meaningful_play"),
                timeToFirstPlayMs: ttfp,
              });
              analytics.track("first_meaningful_play", {
                content_id: item.id,
                series_id: item.seriesId,
                episode_id: item.episodeId,
                time_to_first_play: ttfp,
                page_start_ts: perf.get("page_start"),
                video_load_started_ts: perf.get("video_load_started"),
                video_can_play_ts: perf.get("video_can_play"),
                first_meaningful_play_ts: perf.get("first_meaningful_play"),
              });
              const acquisition = loadAcquisitionContext();
              if (
                !sharePlayTracked.current &&
                (acquisition?.shareId || acquisition?.utmSource === "share")
              ) {
                sharePlayTracked.current = true;
                analytics.track("share_play", {
                  content_id: item.id,
                  series_id: item.seriesId,
                  share_id: acquisition.shareId,
                  utm_source: acquisition.utmSource,
                });
              }
            }
            analytics.track("play", {
              content_id: item.id,
              series_id: item.seriesId,
              episode_id: item.episodeId,
            });
          }}
          onPause={() => {
            patchLaunchDiagnostics({ playerState: "paused" });
            analytics.track("pause", {
              content_id: current?.id ?? null,
            });
          }}
          onBufferingStart={(item) => {
            patchLaunchDiagnostics({ playerState: "buffering" });
            analytics.track("buffer_start", {
              content_id: item.id,
            });
          }}
          onBufferingEnd={(item) => {
            patchLaunchDiagnostics({ playerState: "playing" });
            analytics.track("buffer_end", {
              content_id: item.id,
            });
          }}
          onAutoplayBlocked={() => {
            if (!userStartedPlayback) {
              setAutoplayBlocked(true);
              patchLaunchDiagnostics({
                autoplayBlocked: true,
                playerState: "autoplay_blocked",
              });
            }
          }}
        />

        {resumeOffer && current?.id === resumeOffer.contentId ? (
          <ContinueStrip
            seriesTitle={current.seriesTitle}
            episodeLabel={`Episode ${current.episodeNumber}`}
            onContinue={() => {
              setSeekToMs(resumeOffer.positionMs);
              setResumeOffer(null);
              analytics.track("episode_resume_started", {
                session_id: sessionId,
                content_id: resumeOffer.contentId,
                position_ms: resumeOffer.positionMs,
              });
              const resumeIndex = items.findIndex(
                (item) => item.id === resumeOffer.contentId,
              );
              if (resumeIndex >= 0) setIndex(resumeIndex);
            }}
          />
        ) : null}

        {seriesEnded && current ? (
          <SeriesEnd
            seriesTitle={current.seriesTitle}
            onDismiss={() => {
              setSeriesEnded(false);
              if (index < items.length - 1) {
                setIndex(index + 1);
              }
            }}
          />
        ) : null}

        <IntentSheet
          open={intentOpen}
          onClose={() => setIntentOpen(false)}
          onSelect={(chipId) => {
            analytics.track("intent_select", { chip_id: chipId });
            void handleIntentChip(chipId);
          }}
        />

        {diagOpen ? (
          <LaunchDiagPanel
            onClose={() => setDiagOpen(false)}
            transport={getAnalyticsTransport()}
          />
        ) : null}
      </FeedStage>
    </main>
  );
}
