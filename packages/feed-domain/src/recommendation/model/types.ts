export type RecommendationSource =
  | "editorial"
  | "popular"
  | "affinity"
  | "recent"
  | "continuation"
  | "exploration";

export type RecommendationReason =
  | "editorial"
  | "popular"
  | "completed_same_genre"
  | "followed_series"
  | "similar_taste"
  | "recent_interest"
  | "exploration"
  | "continuation"
  | "language_match"
  | "cold_start";

export type InteractionAction =
  | "view_start"
  | "watch_progress"
  | "complete"
  | "continue"
  | "like"
  | "follow"
  | "skip"
  | "replay";

export type HistoryEntry = {
  contentId: string;
  seriesId: string;
  genres: string[];
  tropes: string[];
  language: string;
  timestamp: number;
  action: InteractionAction;
  watchDurationMs: number;
  completionPercentage: number;
};

export type AffinityMap = Record<string, number>;

export type UserTasteProfile = {
  version: 1;
  likedSeries: AffinityMap;
  likedGenres: AffinityMap;
  likedTropes: AffinityMap;
  watchedSeries: AffinityMap;
  completedSeries: AffinityMap;
  skippedSeries: AffinityMap;
  languageAffinity: AffinityMap;
  completionAffinity: number;
  engagementAffinity: number;
  recentHistory: HistoryEntry[];
  recentSkips: HistoryEntry[];
  interactionCount: number;
  updatedAt: number;
};

export type RecommendationCandidate = {
  contentId: string;
  seriesId: string;
  source: RecommendationSource;
  reasons: RecommendationReason[];
  score: number;
};

export type RecommendationContext = {
  requestId: string;
  sessionId: string;
  seed: number;
  language: string;
  /** When set, next episode in this series must win. */
  activeSeriesId: string | null;
  activeContentId: string | null;
  excludeContentIds: string[];
  limit: number;
  diversityEnabled: boolean;
  explorationEnabled: boolean;
  now: number;
};

export type RecommendationResult = {
  requestId: string;
  items: RecommendationCandidate[];
  coldStart: boolean;
  usedFallback: boolean;
  generatedAt: number;
};
