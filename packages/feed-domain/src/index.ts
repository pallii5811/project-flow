export type {
  Series,
  ContentItem,
  FeedCatalog,
  ContentStatus,
  PlaybackDescriptor,
  PlaybackProviderKind,
  CaptionTrack,
  CaptionKind,
  CaptionTrackStatus,
  LocalizedStrings,
  LocalizedMetadata,
  PreloadHint,
} from "./model/types";
export {
  VERTICAL_ASPECT_MAX,
  VERTICAL_ASPECT_MIN,
  ALLOWED_VIDEO_MIME,
} from "./model/types";
export {
  parseSeries,
  parseContentItem,
  parseCatalog,
  validateCatalog,
  toPublishedCatalog,
  isPlayableStatus,
} from "./model/validate";
export type { ValidationIssue, CatalogValidationResult } from "./model/validate";

export {
  MOCK_CATALOG,
  LAUNCH_CATALOG,
  RAW_LAUNCH_SEED,
  getLaunchFeedCatalog,
} from "./data/catalog";
export {
  STRESS_EPISODES_MAX,
  STRESS_EPISODES_PER_SERIES,
  STRESS_ORDER_OFFSET,
  parseStressEpisodeCount,
  withStressEpisodes,
} from "./data/stressCatalog";

export type {
  FeedSource,
  DeterministicFeedSourceOptions,
} from "./source/deterministicFeedSource";
export { createDeterministicFeedSource } from "./source/deterministicFeedSource";

export type { NextEpisodeResolution } from "./continuation/resolveNextInSeries";
export { resolveNextInSeries } from "./continuation/resolveNextInSeries";

export {
  FEED_CATALOG_PAYLOAD_VERSION,
  firstFramePayload,
  fromFeedCatalogPayload,
  toFeedCatalogPayload,
} from "./catalog/feedCatalogPayload";
export type {
  FeedCatalogPayload,
  FeedItemCopy,
  FeedItemPayload,
} from "./catalog/feedCatalogPayload";

export {
  FEED_EXTEND_WITHIN,
  FEED_PAGE_SIZE,
  FEED_RENDER_RADIUS,
  applyRecommendedPage,
  extendFeedPage,
  needsExtension,
  pageStartingAt,
  placeNextInSeries,
  shouldRenderSlide,
} from "./state/feedPage";
export type { PlacedNextEpisode } from "./state/feedPage";

export type { FeedWindow } from "./state/feedLogic";
export { getFeedWindow, resolveContinuation, getPrefetchIds } from "./state/feedLogic";

export type { ResumeSnapshot, ResumeStore } from "./resume/resumeStore";
export {
  createMemoryResumeStore,
  shouldPersistResume,
  isResumable,
} from "./resume/resumeStore";
export { createLocalStorageResumeStore } from "./resume/localStorageResumeStore";

export {
  slugify,
  episodeSlugFor,
  findBySlugs,
  watchPath,
  watchPathForItem,
} from "./slugs/contentSlugs";
export type { FindBySlugsOptions } from "./slugs/contentSlugs";

export type { WebPerfMark, WebPerfTiming } from "./performance/webPerf";
export { WEB_PERF_MARKS, createWebPerfTiming } from "./performance/webPerf";

export type { RecommendationService } from "./recommendation/service/createRecommendationService";
export {
  createRecommendationService,
  createTestRecommendationService,
  preferLanguage,
} from "./recommendation/service/createRecommendationService";
export { materializeFeedItems } from "./recommendation/service/materializeFeedItems";
export {
  createLocalStorageTasteStore,
  createMemoryTasteStore,
} from "./recommendation/profile/tasteStore";

export {
  createCatalogIntentService,
  INTENT_CHIP_IDS,
  INTENT_CHIP_LABELS,
} from "./intent/createCatalogIntentService";
export type {
  CatalogIntentService,
  IntentChipId,
  WebIntentContext,
  WebIntentResolution,
} from "./intent/createCatalogIntentService";

export type {
  VideoProvider,
  ResolvedPlayback,
  ResolvePlaybackResult,
  PlaybackFailure,
  PlaybackErrorCode,
} from "./playback/videoProvider";
export {
  createStaticVideoProvider,
  classifyPlaybackHttpStatus,
  classifyMediaError,
} from "./playback/videoProvider";
export { isPlayableItem } from "./playback/isPlayable";

export { resolveLocalizedStrings, resolveDisplayCopy } from "./i18n/resolveLocale";
export { selectCaptionTrack } from "./captions/selectCaptionTrack";
export { createWatchProgressThrottle } from "./analytics/watchProgress";
export type {
  WatchProgressEmitter,
  WatchProgressSample,
} from "./analytics/watchProgress";
export {
  AD_CHARTER,
  createAdSession,
  evaluateAdBreak,
  evaluateSponsorCard,
  recordInterruption,
  recordWatchedTime,
} from "./ads/adCharter";
export type {
  AdDecision,
  AdDenialReason,
  AdInterruptionKind,
  AdLedgerEntry,
  AdPlacementContext,
  AdSessionState,
  SponsorPlacementContext,
} from "./ads/adCharter";
export {
  WATCH_SAMPLE_JITTER_TOLERANCE_MS,
  computeWatchedMinutes,
  watchProgressRecordsFromEnvelopes,
} from "./partners/watchedMinutes";
export type {
  EnvelopeConversion,
  WatchProgressRecord,
  WatchedMinutesResult,
  WatchedMinutesRow,
} from "./partners/watchedMinutes";
export { buildProducerStatement } from "./partners/producerStatement";
export type {
  ProducerStatement,
  ProducerStatementInput,
  ProducerStatementIssue,
  ProducerStatementLine,
} from "./partners/producerStatement";
export { logContentEvent } from "./observability/contentLog";
export type { ContentLogEvent, ContentLogFields } from "./observability/contentLog";
