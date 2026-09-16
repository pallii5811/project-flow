/**
 * Binge session — analytical only, never shown in UI.
 *
 * Chain begins: first auto/manual in-series continuation in a session.
 * Chain continues: each subsequent in-series auto/manual continuation
 *   without an intervening skip/swipe to a different series or app cold reset.
 * Chain ends: user swipes away from the series, reaches series end,
 *   hits a failed continuation, or session ends.
 */

export type BingeSession = {
  active: boolean;
  seriesId: string | null;
  episodesStarted: number;
  episodesCompleted: number;
  episodesContinued: number;
  consecutiveEpisodes: number;
  bingeStartedAt: number | null;
  bingeDurationMs: number;
};

export function createBingeSession(): BingeSession {
  return {
    active: false,
    seriesId: null,
    episodesStarted: 0,
    episodesCompleted: 0,
    episodesContinued: 0,
    consecutiveEpisodes: 0,
    bingeStartedAt: null,
    bingeDurationMs: 0,
  };
}

export function noteEpisodeStarted(binge: BingeSession, seriesId: string, now = Date.now()): void {
  binge.episodesStarted += 1;
  if (!binge.active) {
    binge.active = true;
    binge.seriesId = seriesId;
    binge.bingeStartedAt = now;
    binge.consecutiveEpisodes = 1;
    return;
  }
  if (binge.seriesId === seriesId) {
    binge.consecutiveEpisodes += 1;
  } else {
    endBingeChain(binge, now);
    binge.active = true;
    binge.seriesId = seriesId;
    binge.bingeStartedAt = now;
    binge.consecutiveEpisodes = 1;
  }
}

export function noteEpisodeCompleted(binge: BingeSession): void {
  binge.episodesCompleted += 1;
}

export function noteEpisodeContinued(binge: BingeSession, seriesId: string, now = Date.now()): void {
  if (!binge.active || binge.seriesId !== seriesId) {
    binge.active = true;
    binge.seriesId = seriesId;
    binge.bingeStartedAt = now;
    binge.consecutiveEpisodes = 1;
  }
  binge.episodesContinued += 1;
  if (binge.bingeStartedAt !== null) {
    binge.bingeDurationMs = now - binge.bingeStartedAt;
  }
}

export function endBingeChain(binge: BingeSession, now = Date.now()): void {
  if (binge.active && binge.bingeStartedAt !== null) {
    binge.bingeDurationMs = now - binge.bingeStartedAt;
  }
  binge.active = false;
  binge.seriesId = null;
  binge.consecutiveEpisodes = 0;
  binge.bingeStartedAt = null;
}
