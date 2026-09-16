import type { AnalyticsClient } from "@project-flow/analytics";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  Share,
  useWindowDimensions,
  View,
  type AppStateStatus,
  type LayoutChangeEvent,
  type ViewToken,
} from "react-native";

import { contentProps, trackFirstMeaningfulPlay } from "../analytics/feedAnalytics";
import {
  NEAR_END_RATIO,
  reduceEpisodeBoundary,
  type EpisodeBoundaryState,
} from "../continuation/episodeBoundary";
import {
  createBingeSession,
  endBingeChain,
  noteEpisodeCompleted,
  noteEpisodeContinued,
  noteEpisodeStarted,
} from "../continuation/bingeSession";
import { getContinuationPrefetchIds } from "../continuation/prefetch";
import { resolveNextInSeries } from "../continuation/resolveNextInSeries";
import { MOCK_CATALOG } from "../data/catalog";
import type { ContentItem } from "../model/types";
import type { PlaybackState } from "../player/playbackState";
import { createAsyncResumeStore } from "../resume/asyncResumeStore";
import {
  isResumable,
  shouldPersistResume,
  type ResumeSnapshot,
  type ResumeStore,
} from "../resume/resumeStore";
import {
  createFirstPlayTiming,
  createWatchSessionStats,
  type FirstPlayTiming,
  type WatchSessionStats,
} from "../session/timing";
import { createDeterministicFeedSource } from "../source/deterministicFeedSource";
import {
  trackRecommendationCompleted,
  trackRecommendationImpression,
  trackRecommendationPlayStarted,
  trackRecommendationSkipped,
} from "../../recommendation/analytics/recommendationAnalytics";
import {
  createRecommendationService,
  materializeFeedItems,
  type RecommendationCandidate,
  type RecommendationService,
} from "../../recommendation";
import {
  createIntentService,
  IntentSheet,
  trackIntentResultCompleted,
  trackIntentResultPlayed,
  trackIntentResultSkipped,
  trackIntentSheetOpened,
  type IntentChipId,
  type IntentService,
} from "../../intent";
import {
  createDemandGraphService,
  hashAnonymousId,
} from "../../demand-graph";
import { createMockSceneGraphDocument } from "../../scene-graph/fixtures/mockSceneGraph";
import { ContinueStrip } from "./ContinueStrip";
import { FeedItem } from "./FeedItem";
import { SeriesEndState } from "./SeriesEndState";

type FeedScreenProps = {
  analytics: AnalyticsClient;
  sessionId: string;
  resumeStore?: ResumeStore;
  recommendationEnabled?: boolean;
  diversityEnabled?: boolean;
  explorationEnabled?: boolean;
  recommendationService?: RecommendationService;
  intentLayerEnabled?: boolean;
  intentChipsEnabled?: boolean;
  intentNlEnabled?: boolean;
  intentService?: IntentService;
  demandGraphEnabled?: boolean;
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type TransitionMeta = {
  fromId: string;
  toId: string;
  startedAt: number;
  prepareStartedAt: number | null;
  nextWasReady: boolean;
};

export function FeedScreen({
  analytics,
  sessionId,
  resumeStore = createAsyncResumeStore(),
  recommendationEnabled = false,
  diversityEnabled = false,
  explorationEnabled = false,
  recommendationService: injectedService,
  intentLayerEnabled = false,
  intentChipsEnabled = false,
  intentNlEnabled = false,
  intentService: injectedIntentService,
  demandGraphEnabled = false,
}: FeedScreenProps): ReactElement {
  const window = useWindowDimensions();
  const [viewportHeight, setViewportHeight] = useState(window.height);
  const height = viewportHeight > 0 ? viewportHeight : window.height;

  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next > 0) {
      setViewportHeight((prev) => (prev === next ? prev : next));
    }
  }, []);

  const source = useMemo(() => createDeterministicFeedSource(MOCK_CATALOG), []);
  const catalogItems = useMemo(() => source.getOrderedItems(), [source]);
  // Editorial first — never block OPEN → first video on recommendation.
  const [items, setItems] = useState<ContentItem[]>(catalogItems);

  const recommendationService = useMemo(() => {
    if (injectedService) return injectedService;
    return createRecommendationService({
      catalog: catalogItems,
      feedSource: source,
      analytics,
      sessionId,
      enabled: recommendationEnabled,
      diversityEnabled,
      explorationEnabled,
    });
  }, [
    analytics,
    catalogItems,
    diversityEnabled,
    explorationEnabled,
    injectedService,
    recommendationEnabled,
    sessionId,
    source,
  ]);

  const demandGraph = useMemo(() => {
    if (!demandGraphEnabled) return null;
    return createDemandGraphService({
      analytics,
      catalog: catalogItems,
      enabled: true,
    });
  }, [analytics, catalogItems, demandGraphEnabled]);

  const intentService = useMemo(() => {
    if (injectedIntentService) return injectedIntentService;
    if (!intentLayerEnabled) return null;
    return createIntentService({
      analytics,
      sessionId,
      catalog: catalogItems,
      nlEnabled: intentNlEnabled,
      getSceneDocument: async () => createMockSceneGraphDocument(),
      onDemandSignal: demandGraph
        ? (resolution) => {
            void demandGraph.ingestFromIntentResolution(resolution, {
              anonymousIdHash: hashAnonymousId(sessionId),
              language: "en",
            });
          }
        : undefined,
    });
  }, [
    analytics,
    catalogItems,
    demandGraph,
    injectedIntentService,
    intentLayerEnabled,
    intentNlEnabled,
    sessionId,
  ]);

  const listRef = useRef<FlatList<ContentItem>>(null);
  const timingRef = useRef<FirstPlayTiming>(createFirstPlayTiming());
  const sessionRef = useRef<WatchSessionStats>(createWatchSessionStats(sessionId));
  const bingeRef = useRef(createBingeSession());
  const firstPlayTracked = useRef(false);
  const startedForItem = useRef<string | null>(null);
  const viewedIds = useRef(new Set<string>());
  const watchStartedAt = useRef<number | null>(Date.now());
  const prevIndexRef = useRef(0);
  const progressRef = useRef(0);
  const durationRef = useRef(0);
  const lastPersisted = useRef<ResumeSnapshot | null>(null);
  const transitionRef = useRef<TransitionMeta | null>(null);
  const autoContinueLock = useRef(false);
  const nearEndArmed = useRef(false);
  const nextReadyIds = useRef(new Set<string>());
  const resumeSeekMs = useRef(0);
  const suppressSkipRef = useRef(false);
  const recRequestIdRef = useRef<string | null>(null);
  const recMetaRef = useRef(new Map<string, RecommendationCandidate>());
  const impressedRecIds = useRef(new Set<string>());
  const indexRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const sessionRecLoaded = useRef(false);

  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState(0);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [boundary, setBoundary] = useState<EpisodeBoundaryState>("playing");
  const [showResumeStrip, setShowResumeStrip] = useState(false);
  const [showSeriesEnd, setShowSeriesEnd] = useState(false);
  const [continueFailed, setContinueFailed] = useState(false);
  const [resumeBootstrapped, setResumeBootstrapped] = useState(false);
  const [intentSheetOpen, setIntentSheetOpen] = useState(false);
  const [intentBusy, setIntentBusy] = useState(false);
  const [intentHint, setIntentHint] = useState<string | null>(null);
  const pendingIntentContentId = useRef<string | null>(null);
  const pendingIntentId = useRef<string | null>(null);
  const pendingIntentMatch = useRef(0);

  const current = items[index];
  indexRef.current = index;
  const prefetchIds = useMemo(
    () => getContinuationPrefetchIds(source, items, index, progress),
    [source, items, index, progress],
  );

  const applyRecommendationOrder = useCallback(
    (ordered: ContentItem[], meta: Map<string, RecommendationCandidate>, requestId: string) => {
      recRequestIdRef.current = requestId;
      recMetaRef.current = meta;
      const currentItems = itemsRef.current;
      const currentId = currentItems[indexRef.current]?.id;
      if (!currentId) {
        setItems(ordered);
        return;
      }
      // Keep currently playing item stable; reorder only around it.
      const seen = new Set<string>();
      const deduped: ContentItem[] = [];
      const prefix = currentItems.slice(0, indexRef.current + 1);
      for (const item of prefix) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        deduped.push(item);
      }
      for (const item of ordered) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        deduped.push(item);
      }
      setItems(deduped);
    },
    [],
  );

  const refreshRecommendations = useCallback(async () => {
    if (!recommendationEnabled && !injectedService) return;
    const active = itemsRef.current[indexRef.current];
    try {
      const result = await recommendationService.getOrderedItems({
        sessionId,
        seed: hashSeed(sessionId),
        language: active?.language ?? "en",
        activeSeriesId: active?.seriesId ?? null,
        activeContentId: active?.id ?? null,
        excludeContentIds: [],
        limit: catalogItems.length,
        diversityEnabled,
        explorationEnabled,
        now: Date.now(),
      });
      const { items: ordered, metaByContentId } = materializeFeedItems(
        result,
        catalogItems,
      );
      applyRecommendationOrder(ordered, metaByContentId, result.requestId);
    } catch {
      // Editorial items already on screen — do nothing.
    }
  }, [
    applyRecommendationOrder,
    catalogItems,
    diversityEnabled,
    explorationEnabled,
    injectedService,
    recommendationEnabled,
    recommendationService,
    sessionId,
  ]);

  // Session-start recommendation refresh (non-blocking, once per session).
  useEffect(() => {
    if (!recommendationEnabled && !injectedService) return;
    if (sessionRecLoaded.current) return;
    sessionRecLoaded.current = true;
    void refreshRecommendations();
  }, [injectedService, recommendationEnabled, refreshRecommendations]);

  const recordSignalFor = useCallback(
    (
      item: ContentItem,
      action: "view_start" | "complete" | "continue" | "like" | "follow" | "skip" | "replay",
      completionPercentage: number,
      watchDurationMs: number,
    ) => {
      if (!recommendationEnabled && !injectedService) return;
      void recommendationService.recordSignal({
        contentId: item.id,
        seriesId: item.seriesId,
        genres: item.genres,
        tropes: item.tropes,
        language: item.language,
        action,
        watchDurationMs,
        completionPercentage,
      });
    },
    [injectedService, recommendationEnabled, recommendationService],
  );

  const pushBoundary = useCallback((event: Parameters<typeof reduceEpisodeBoundary>[1]) => {
    setBoundary((prev) => reduceEpisodeBoundary(prev, event));
  }, []);

  const scrollTo = useCallback((nextIndex: number, animated = true) => {
    setIndex(nextIndex);
    listRef.current?.scrollToIndex({ index: nextIndex, animated });
  }, []);

  const buildIntentContext = useCallback(() => {
    const active = itemsRef.current[indexRef.current];
    return {
      contentId: active?.id ?? null,
      seriesId: active?.seriesId ?? null,
      episodeId: active?.episodeId ?? null,
      genres: active?.genres ?? [],
      tropes: active?.tropes ?? [],
      language: active?.language ?? "en",
      recentContentIds: itemsRef.current.slice(0, 5).map((i) => i.id),
    };
  }, []);

  const applyIntentCandidates = useCallback(
    (candidateIds: string[]) => {
      if (candidateIds.length === 0) return;
      const byId = new Map(catalogItems.map((item) => [item.id, item]));
      const currentItems = itemsRef.current;
      const currentIndex = indexRef.current;
      const prefix = currentItems.slice(0, currentIndex + 1);
      const seen = new Set(prefix.map((i) => i.id));
      const injected: ContentItem[] = [];
      for (const id of candidateIds) {
        const item = byId.get(id);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        injected.push(item);
      }
      const rest = currentItems.filter((item) => !seen.has(item.id));
      for (const item of catalogItems) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        rest.push(item);
      }
      setItems([...prefix, ...injected, ...rest]);
    },
    [catalogItems],
  );

  const handleIntentResolution = useCallback(
    async (resolution: Awaited<ReturnType<IntentService["resolveChip"]>>) => {
      setIntentBusy(false);
      setIntentSheetOpen(false);
      if (resolution.status === "unresolved" || resolution.candidates.length === 0) {
        setIntentHint("Keeping your feed — try another vibe.");
        return;
      }
      setIntentHint(null);
      const topId = resolution.candidates[0]!.contentId;
      pendingIntentContentId.current = topId;
      pendingIntentId.current = resolution.intentId;
      pendingIntentMatch.current = resolution.matchStrength;
      applyIntentCandidates(resolution.candidates.map((c) => c.contentId));
      // Current video keeps playing — user swipes into the steered item.
    },
    [applyIntentCandidates],
  );

  const onOpenIntent = useCallback(() => {
    if (!intentService) return;
    setIntentHint(null);
    setIntentSheetOpen(true);
    trackIntentSheetOpened(
      analytics,
      sessionId,
      itemsRef.current[indexRef.current]?.id ?? null,
    );
  }, [analytics, intentService, sessionId]);

  const onSelectIntentChip = useCallback(
    (chipId: IntentChipId) => {
      if (!intentService) return;
      setIntentBusy(true);
      void intentService
        .resolveChip(chipId, buildIntentContext())
        .then(handleIntentResolution)
        .catch(() => {
          setIntentBusy(false);
          setIntentSheetOpen(false);
          setIntentHint("Keeping your feed — try another vibe.");
        });
    },
    [buildIntentContext, handleIntentResolution, intentService],
  );

  const onSubmitIntentText = useCallback(
    (text: string) => {
      if (!intentService) return;
      setIntentBusy(true);
      void intentService
        .resolveText(text, buildIntentContext())
        .then(handleIntentResolution)
        .catch(() => {
          setIntentBusy(false);
          setIntentSheetOpen(false);
          setIntentHint("Keeping your feed — try another vibe.");
        });
    },
    [buildIntentContext, handleIntentResolution, intentService],
  );

  // Restore anonymous resume on boot.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snapshot = await resumeStore.load();
      lastPersisted.current = snapshot;
      if (cancelled || !isResumable(snapshot)) {
        setResumeBootstrapped(true);
        return;
      }
      const resumeIndex = items.findIndex((item) => item.id === snapshot.contentId);
      if (resumeIndex < 0) {
        setResumeBootstrapped(true);
        return;
      }
      suppressSkipRef.current = true;
      prevIndexRef.current = resumeIndex;
      resumeSeekMs.current = snapshot.positionMs;
      setMuted(snapshot.muted);
      setCaptionsOn(snapshot.captionsOn);
      setPaused(true);
      setShowResumeStrip(true);
      setIndex(resumeIndex);
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: resumeIndex, animated: false });
      });
      analytics.track("episode_resume_started", {
        content_id: snapshot.contentId,
        series_id: snapshot.seriesId,
        episode_id: snapshot.episodeId,
        position_ms: snapshot.positionMs,
      });
      setResumeBootstrapped(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [analytics, items, resumeStore]);

  useEffect(() => {
    if (!current || !resumeBootstrapped) return;
    if (!viewedIds.current.has(current.id)) {
      viewedIds.current.add(current.id);
      sessionRef.current.videosViewed += 1;
      noteEpisodeStarted(bingeRef.current, current.seriesId);
      recordSignalFor(current, "view_start", 0, 0);
      const meta = recMetaRef.current.get(current.id);
      const requestId = recRequestIdRef.current;
      if (meta && requestId && !impressedRecIds.current.has(current.id)) {
        impressedRecIds.current.add(current.id);
        const rank = items.findIndex((item) => item.id === current.id);
        trackRecommendationImpression(analytics, requestId, meta, Math.max(0, rank));
      }
    }
    setProgress(0);
    progressRef.current = 0;
    durationRef.current = current.durationMs;
    setPlaybackState("loading");
    if (!showResumeStrip) {
      setPaused(false);
    }
    setShowSeriesEnd(false);
    setContinueFailed(false);
    nearEndArmed.current = false;
    autoContinueLock.current = false;
    pushBoundary({ type: "RESET_PLAYING" });
    watchStartedAt.current = Date.now();
    startedForItem.current = null;

    if (timingRef.current.firstPlayAttemptTimestamp === null) {
      timingRef.current.firstPlayAttemptTimestamp = Date.now();
      analytics.track("first_play_attempted", contentProps(current));
    }
  }, [analytics, current, items, pushBoundary, recordSignalFor, resumeBootstrapped, showResumeStrip]);

  useEffect(() => {
    if (index === prevIndexRef.current) return;
    const fromIndex = prevIndexRef.current;
    const from = items[fromIndex];
    const watchMs =
      watchStartedAt.current === null ? 0 : Date.now() - watchStartedAt.current;

    if (from && !suppressSkipRef.current) {
      const completionPercentage = Math.round(progressRef.current * 100);
      sessionRef.current.videosSkipped += 1;
      sessionRef.current.watchDurationMs += watchMs;
      analytics.track("video_skipped", {
        ...contentProps(from),
        watch_duration_ms: watchMs,
        position_ms: Math.round(progressRef.current * from.durationMs),
        completion_percentage: completionPercentage,
      });
      recordSignalFor(from, "skip", completionPercentage, watchMs);
      const meta = recMetaRef.current.get(from.id);
      const requestId = recRequestIdRef.current;
      if (meta && requestId) {
        trackRecommendationSkipped(
          analytics,
          requestId,
          meta,
          fromIndex,
          completionPercentage,
        );
      }
      if (
        pendingIntentContentId.current === from.id &&
        pendingIntentId.current
      ) {
        trackIntentResultSkipped(analytics, {
          intent_id: pendingIntentId.current,
          session_id: sessionId,
          selected_content_id: from.id,
          selected_series_id: from.seriesId,
        });
        pendingIntentContentId.current = null;
        pendingIntentId.current = null;
      }
      analytics.track(
        index > fromIndex ? "feed_swiped_next" : "feed_swiped_previous",
        contentProps(from),
      );
      const to = items[index];
      if (to && from.seriesId !== to.seriesId) {
        endBingeChain(bingeRef.current);
      }
    }
    suppressSkipRef.current = false;
    prevIndexRef.current = index;
    resumeSeekMs.current = 0;
  }, [analytics, index, items, recordSignalFor, sessionId]);

  const persistProgress = useCallback(
    async (partial: Partial<ResumeSnapshot> & { contentId: string }) => {
      if (!current || partial.contentId !== current.id) return;
      const snapshot: ResumeSnapshot = {
        contentId: current.id,
        seriesId: current.seriesId,
        episodeId: current.episodeId,
        positionMs: partial.positionMs ?? Math.round(progressRef.current * current.durationMs),
        durationMs: partial.durationMs ?? durationRef.current,
        muted: partial.muted ?? muted,
        captionsOn: partial.captionsOn ?? captionsOn,
        updatedAt: Date.now(),
        completed: partial.completed ?? false,
      };
      if (!shouldPersistResume(lastPersisted.current, snapshot)) return;
      lastPersisted.current = snapshot;
      await resumeStore.save(snapshot);
    },
    [captionsOn, current, muted, resumeStore],
  );

  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status === "background" || status === "inactive") {
        if (current) {
          void persistProgress({ contentId: current.id });
        }
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [current, persistProgress]);

  const beginAutoContinue = useCallback(
    (nextIndex: number, next: ContentItem, manual: boolean) => {
      if (!current || autoContinueLock.current) return;
      autoContinueLock.current = true;
      const now = Date.now();
      const nextWasReady = nextReadyIds.current.has(next.id);
      transitionRef.current = {
        fromId: current.id,
        toId: next.id,
        startedAt: now,
        prepareStartedAt: nearEndArmed.current ? now : null,
        nextWasReady,
      };

      pushBoundary({ type: "TRANSITION_STARTED" });
      analytics.track("episode_transition_started", {
        ...contentProps(current),
        next_episode_id: next.episodeId,
        whether_next_episode_was_ready: nextWasReady,
      });
      if (manual) {
        analytics.track("episode_continue_tapped", {
          ...contentProps(current),
          next_episode_id: next.episodeId,
        });
      } else {
        analytics.track("episode_auto_continued", {
          ...contentProps(current),
          next_episode_id: next.episodeId,
          whether_next_episode_was_ready: nextWasReady,
        });
      }

      noteEpisodeContinued(bingeRef.current, current.seriesId);
      recordSignalFor(current, "continue", 100, current.durationMs);
      void persistProgress({ contentId: current.id, completed: true, positionMs: current.durationMs });
      suppressSkipRef.current = true;
      prevIndexRef.current = nextIndex;
      resumeSeekMs.current = 0;
      setShowResumeStrip(false);
      setShowSeriesEnd(false);
      scrollTo(nextIndex, true);
    },
    [analytics, current, persistProgress, pushBoundary, recordSignalFor, scrollTo],
  );

  const handleEnded = useCallback(() => {
    if (!current || autoContinueLock.current) return;
    const endAt = Date.now();
    sessionRef.current.videosCompleted += 1;
    noteEpisodeCompleted(bingeRef.current);
    analytics.track("video_completed", {
      ...contentProps(current),
      completion_percentage: 100,
      watch_duration_ms: current.durationMs,
    });
    recordSignalFor(current, "complete", 100, current.durationMs);
    const meta = recMetaRef.current.get(current.id);
    const requestId = recRequestIdRef.current;
    if (meta && requestId) {
      trackRecommendationCompleted(analytics, requestId, meta, index);
    }
    if (
      pendingIntentContentId.current === current.id &&
      pendingIntentId.current
    ) {
      trackIntentResultCompleted(analytics, {
        intent_id: pendingIntentId.current,
        session_id: sessionId,
        selected_content_id: current.id,
        selected_series_id: current.seriesId,
      });
      pendingIntentContentId.current = null;
      pendingIntentId.current = null;
    }
    pushBoundary({ type: "COMPLETED" });

    const resolution = resolveNextInSeries(source, items, index);
    if (resolution.kind === "series_complete") {
      pushBoundary({ type: "NO_NEXT" });
      analytics.track("series_end_reached", contentProps(current));
      analytics.track("series_completed", contentProps(current));
      endBingeChain(bingeRef.current);
      void persistProgress({
        contentId: current.id,
        completed: true,
        positionMs: current.durationMs,
      });
      setShowSeriesEnd(true);
      setPaused(true);
      return;
    }

    analytics.track("next_episode_resolved", {
      ...contentProps(current),
      next_episode_id: resolution.next.episodeId,
    });
    pushBoundary({ type: "NEXT_RESOLVED", nextEpisodeId: resolution.next.id });

    const ready = nextReadyIds.current.has(resolution.next.id);
    if (!ready) {
      analytics.track("next_episode_prepare_started", {
        ...contentProps(current),
        next_episode_id: resolution.next.episodeId,
      });
      pushBoundary({ type: "PREPARE_STARTED" });
    }

    // Auto-continue in-series only.
    beginAutoContinue(resolution.nextIndex, resolution.next, false);

    const transition = transitionRef.current;
    if (transition) {
      analytics.track("episode_transition_completed", {
        ...contentProps(current),
        next_episode_id: resolution.next.episodeId,
        transition_duration_ms: Date.now() - transition.startedAt,
        time_from_episode_end_ms: Date.now() - endAt,
        whether_next_episode_was_ready: transition.nextWasReady,
        episode_end_to_next_play_ms: Date.now() - endAt,
      });
      pushBoundary({ type: "TRANSITION_COMPLETED" });
    }
  }, [
    analytics,
    beginAutoContinue,
    current,
    index,
    items,
    persistProgress,
    pushBoundary,
    recordSignalFor,
    sessionId,
    source,
  ]);

  const handleError = useCallback(
    (message: string) => {
      if (!current) return;
      analytics.track("playback_error", {
        ...contentProps(current),
        message,
        failure_stage: boundary,
        retry_count: 1,
      });

      if (boundary === "preparing_next" || boundary === "transitioning" || boundary === "ending") {
        pushBoundary({ type: "PREPARE_FAILED", message });
        analytics.track("next_episode_prepare_failed", {
          ...contentProps(current),
          message,
        });
        setContinueFailed(true);
        setPaused(true);
        return;
      }

      // Non-continuation playback error: skip to next feed item (swipe path), not unrelated autoplay claim.
      const nextIndex = Math.min(index + 1, items.length - 1);
      if (nextIndex !== index) {
        suppressSkipRef.current = true;
        prevIndexRef.current = nextIndex;
        scrollTo(nextIndex, true);
      }
    },
    [analytics, boundary, current, index, items.length, pushBoundary, scrollTo],
  );

  const handleProgress = useCallback(
    (positionMs: number, durationMs: number) => {
      if (!current) return;
      if (durationMs <= 0) {
        setProgress(0);
        progressRef.current = 0;
        return;
      }
      durationRef.current = durationMs;
      const ratio = Math.min(1, positionMs / durationMs);
      progressRef.current = ratio;
      setProgress(ratio);

      void persistProgress({
        contentId: current.id,
        positionMs: Math.round(positionMs),
        durationMs: Math.round(durationMs),
      });

      if (ratio >= NEAR_END_RATIO && !nearEndArmed.current) {
        nearEndArmed.current = true;
        pushBoundary({ type: "NEAR_END" });
        const resolution = resolveNextInSeries(source, items, index);
        if (resolution.kind === "next_in_series") {
          analytics.track("next_episode_resolved", {
            ...contentProps(current),
            next_episode_id: resolution.next.episodeId,
          });
          analytics.track("next_episode_prepare_started", {
            ...contentProps(current),
            next_episode_id: resolution.next.episodeId,
          });
          pushBoundary({
            type: "NEXT_RESOLVED",
            nextEpisodeId: resolution.next.id,
          });
          pushBoundary({ type: "PREPARE_STARTED" });
          if (nextReadyIds.current.has(resolution.next.id)) {
            analytics.track("next_episode_ready", {
              ...contentProps(current),
              next_episode_id: resolution.next.episodeId,
              next_episode_ready_before_completion: true,
            });
            pushBoundary({ type: "PREPARE_READY" });
          }
        }
      }
    },
    [analytics, current, index, items, persistProgress, pushBoundary, source],
  );

  const handleStateChange = useCallback(
    (state: PlaybackState) => {
      setPlaybackState((prev) => {
        if (prev === "buffering" && state === "playing" && current) {
          analytics.track("buffering_ended", contentProps(current));
        }
        return state;
      });
      if (!current) return;

      if (state === "ready" && timingRef.current.videoReadyTimestamp === null) {
        timingRef.current.videoReadyTimestamp = Date.now();
        analytics.track("video_ready", contentProps(current));
      }

      if (state === "playing") {
        if (timingRef.current.actualPlaybackTimestamp === null) {
          timingRef.current.actualPlaybackTimestamp = Date.now();
        }
        if (!firstPlayTracked.current) {
          firstPlayTracked.current = true;
          trackFirstMeaningfulPlay(analytics, timingRef.current, current);
        }
        if (startedForItem.current !== current.id) {
          startedForItem.current = current.id;
          analytics.track("video_started", contentProps(current));
          const meta = recMetaRef.current.get(current.id);
          const requestId = recRequestIdRef.current;
          if (meta && requestId) {
            const rank = items.findIndex((item) => item.id === current.id);
            trackRecommendationPlayStarted(
              analytics,
              requestId,
              meta,
              Math.max(0, rank),
            );
          }
          if (
            pendingIntentContentId.current === current.id &&
            pendingIntentId.current
          ) {
            trackIntentResultPlayed(analytics, {
              intent_id: pendingIntentId.current,
              session_id: sessionId,
              selected_content_id: current.id,
              selected_series_id: current.seriesId,
              match_strength: Number(pendingIntentMatch.current.toFixed(3)),
            });
            intentService?.consumeNextItemBias();
          }
        }
        if (resumeSeekMs.current > 0) {
          analytics.track("episode_resume_position_restored", {
            ...contentProps(current),
            position_ms: resumeSeekMs.current,
          });
          resumeSeekMs.current = 0;
        }
      }

      if (state === "buffering") {
        analytics.track("buffering_started", contentProps(current));
      }
    },
    [analytics, current, intentService, items, sessionId],
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index == null) return;
      if (autoContinueLock.current) return;
      setIndex(first.index);
    },
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80,
  }).current;

  const onTogglePlay = useCallback(() => {
    setPaused((value) => {
      const next = !value;
      if (current) {
        analytics.track(next ? "video_paused" : "video_resumed", contentProps(current));
      }
      return next;
    });
  }, [analytics, current]);

  const onContinueResume = useCallback(() => {
    setShowResumeStrip(false);
    setPaused(false);
    if (current) {
      analytics.track("episode_continue_tapped", contentProps(current));
    }
  }, [analytics, current]);

  const onManualContinueAfterFail = useCallback(() => {
    if (!current) return;
    const resolution = resolveNextInSeries(source, items, index);
    if (resolution.kind !== "next_in_series") {
      setShowSeriesEnd(true);
      return;
    }
    setContinueFailed(false);
    beginAutoContinue(resolution.nextIndex, resolution.next, true);
  }, [beginAutoContinue, current, index, items, source]);

  return (
    <View style={{ flex: 1 }} onLayout={onViewportLayout}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        windowSize={3}
        maxToRenderPerBatch={3}
        initialNumToRender={2}
        removeClippedSubviews
        getItemLayout={(_, rowIndex) => ({
          length: height,
          offset: height * rowIndex,
          index: rowIndex,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onScrollToIndexFailed={({ index: failedIndex }) => {
          requestAnimationFrame(() => {
            listRef.current?.scrollToIndex({ index: failedIndex, animated: false });
          });
        }}
        renderItem={({ item, index: rowIndex }) => (
          <FeedItem
            item={item}
            height={height}
            active={rowIndex === index}
            prepared={prefetchIds.has(item.id)}
            muted={muted}
            liked={Boolean(liked[item.id])}
            following={Boolean(following[item.seriesId])}
            captionsOn={captionsOn}
            shouldPlay={!paused}
            progress={rowIndex === index ? progress : 0}
            playbackState={rowIndex === index ? playbackState : "idle"}
            initialPositionMs={
              rowIndex === index && resumeSeekMs.current > 0 ? resumeSeekMs.current : 0
            }
            intentEnabled={intentLayerEnabled}
            onOpenIntent={intentLayerEnabled ? onOpenIntent : undefined}
            onTogglePlay={onTogglePlay}
            onToggleMute={() => {
              setMuted((value) => {
                const next = !value;
                if (current) {
                  void persistProgress({ contentId: current.id, muted: next });
                }
                return next;
              });
            }}
            onToggleLike={() => {
              setLiked((map) => {
                const next = !map[item.id];
                analytics.track("like_tapped", {
                  ...contentProps(item),
                  liked: next,
                });
                if (next) {
                  recordSignalFor(item, "like", Math.round(progressRef.current * 100), 0);
                }
                return { ...map, [item.id]: next };
              });
            }}
            onToggleFollow={() => {
              setFollowing((map) => {
                const next = !map[item.seriesId];
                analytics.track("follow_tapped", {
                  ...contentProps(item),
                  following: next,
                });
                if (next) {
                  recordSignalFor(item, "follow", Math.round(progressRef.current * 100), 0);
                }
                return { ...map, [item.seriesId]: next };
              });
            }}
            onShare={() => {
              analytics.track("share_tapped", contentProps(item));
              void Share.share({
                message: `${item.seriesTitle} · ${item.title}`,
              });
            }}
            onToggleCaptions={() => {
              setCaptionsOn((value) => {
                const next = !value;
                analytics.track("caption_toggled", {
                  ...contentProps(item),
                  captions_on: next,
                });
                if (current) {
                  void persistProgress({ contentId: current.id, captionsOn: next });
                }
                return next;
              });
            }}
            onStateChange={handleStateChange}
            onProgress={handleProgress}
            onEnded={handleEnded}
            onError={handleError}
            onReady={() => {
              nextReadyIds.current.add(item.id);
              if (
                current &&
                nearEndArmed.current &&
                item.seriesId === current.seriesId &&
                item.episodeNumber === current.episodeNumber + 1
              ) {
                analytics.track("next_episode_ready", {
                  ...contentProps(current),
                  next_episode_id: item.episodeId,
                  next_episode_ready_before_completion: progressRef.current < 1,
                });
                pushBoundary({ type: "PREPARE_READY" });
              }
            }}
          />
        )}
      />

      {showResumeStrip && current ? (
        <ContinueStrip
          seriesTitle={current.seriesTitle}
          episodeLabel={`Episode ${current.episodeNumber}`}
          onContinue={onContinueResume}
        />
      ) : null}

      {continueFailed && current ? (
        <ContinueStrip
          seriesTitle={current.seriesTitle}
          episodeLabel="Couldn't continue — tap to retry"
          onContinue={onManualContinueAfterFail}
        />
      ) : null}

      {showSeriesEnd && current ? (
        <SeriesEndState
          seriesTitle={current.seriesTitle}
          onDismiss={() => {
            setShowSeriesEnd(false);
            const nextIndex = Math.min(index + 1, items.length - 1);
            if (nextIndex !== index) {
              suppressSkipRef.current = true;
              prevIndexRef.current = nextIndex;
              scrollTo(nextIndex, true);
            }
          }}
        />
      ) : null}

      {intentLayerEnabled ? (
        <IntentSheet
          visible={intentSheetOpen}
          chipsEnabled={intentChipsEnabled}
          nlEnabled={intentNlEnabled}
          busy={intentBusy}
          unresolvedHint={intentHint}
          onClose={() => setIntentSheetOpen(false)}
          onSelectChip={onSelectIntentChip}
          onSubmitText={intentNlEnabled ? onSubmitIntentText : undefined}
        />
      ) : null}
    </View>
  );
}
