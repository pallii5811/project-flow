import type { AnalyticsClient } from "@project-flow/analytics";

import type { ContentItem } from "../model/types";
import {
  INTENT_CHIP_IDS,
  INTENT_CHIP_LABELS,
  type IntentChipId,
} from "./model/taxonomy";

export type WebIntentContext = {
  contentId: string | null;
  seriesId: string | null;
  genres: string[];
  tropes: string[];
};

export type WebIntentCandidate = {
  contentId: string;
  seriesId: string;
  score: number;
};

export type WebIntentResolution = {
  intentId: string;
  status: "resolved" | "weak_match" | "unresolved";
  chipId: IntentChipId;
  candidates: WebIntentCandidate[];
  matchStrength: number;
};

export type CatalogIntentService = {
  resolveChip(
    chipId: IntentChipId,
    context: WebIntentContext,
  ): Promise<WebIntentResolution>;
  resolveText(
    text: string,
    context: WebIntentContext,
  ): Promise<WebIntentResolution>;
  consumeNextItemBias(): WebIntentResolution | null;
  clear(): void;
};

const CHIP_TAGS: Record<IntentChipId, { genres: string[]; tropes: string[] }> = {
  MORE_LIKE_THIS: { genres: [], tropes: [] },
  MORE_ROMANCE: { genres: ["romance"], tropes: ["slow_burn", "contract"] },
  DARKER: { genres: ["horror", "thriller"], tropes: ["survival", "mystery"] },
  MORE_REVENGE: { genres: ["thriller", "drama"], tropes: ["revenge", "betrayal"] },
  STRONG_FEMALE_LEAD: { genres: ["drama", "thriller"], tropes: ["revenge"] },
  SURPRISE_ME: { genres: [], tropes: [] },
};

function scoreItem(
  item: ContentItem,
  chipId: IntentChipId,
  context: WebIntentContext,
  salt: number,
): number {
  if (chipId === "SURPRISE_ME") {
    return item.popularityScore * 0.3 + ((salt + item.order * 17) % 40);
  }
  if (chipId === "MORE_LIKE_THIS") {
    const genreHit = item.genres.filter((g) => context.genres.includes(g)).length;
    const tropeHit = item.tropes.filter((t) => context.tropes.includes(t)).length;
    return genreHit * 30 + tropeHit * 25 + item.popularityScore * 0.2;
  }
  const tags = CHIP_TAGS[chipId];
  const genreHit = item.genres.filter((g) => tags.genres.includes(g)).length;
  const tropeHit = item.tropes.filter((t) => tags.tropes.includes(t)).length;
  return genreHit * 40 + tropeHit * 35 + item.popularityScore * 0.15;
}

function guessChipFromText(text: string): IntentChipId {
  const t = text.toLowerCase();
  if (t.includes("romance") || t.includes("romantic") || t.includes("love")) {
    return "MORE_ROMANCE";
  }
  if (t.includes("dark") || t.includes("horror")) return "DARKER";
  if (t.includes("revenge")) return "MORE_REVENGE";
  if (t.includes("female") || t.includes("her")) return "STRONG_FEMALE_LEAD";
  if (t.includes("surprise") || t.includes("random")) return "SURPRISE_ME";
  return "MORE_LIKE_THIS";
}

/**
 * Catalog-tag Intent for web — no Scene Graph on the critical path.
 */
export function createCatalogIntentService(options: {
  analytics: AnalyticsClient;
  sessionId: string;
  catalog: ContentItem[];
  nlEnabled?: boolean;
}): CatalogIntentService {
  const { analytics, sessionId, catalog, nlEnabled = false } = options;
  let active: WebIntentResolution | null = null;

  const resolve = (
    chipId: IntentChipId,
    context: WebIntentContext,
  ): WebIntentResolution => {
    const ranked = [...catalog]
      .filter((item) => item.id !== context.contentId)
      .map((item) => ({
        contentId: item.id,
        seriesId: item.seriesId,
        score: scoreItem(item, chipId, context, Date.now() % 1000),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const top = ranked[0]?.score ?? 0;
    const status: WebIntentResolution["status"] =
      ranked.length === 0 ? "unresolved" : top < 20 ? "weak_match" : "resolved";

    const resolution: WebIntentResolution = {
      intentId: `intent_${Date.now().toString(36)}`,
      status,
      chipId,
      candidates: ranked,
      matchStrength: Math.min(1, top / 100),
    };
    active = resolution;
    return resolution;
  };

  return {
    async resolveChip(chipId, context) {
      analytics.track("intent_chip_selected", {
        session_id: sessionId,
        chip_id: chipId,
        label: INTENT_CHIP_LABELS[chipId],
      });
      return resolve(chipId, context);
    },
    async resolveText(text, context) {
      const chip = nlEnabled ? guessChipFromText(text) : "SURPRISE_ME";
      analytics.track("intent_text_submitted", {
        session_id: sessionId,
        text_length: text.length,
      });
      return resolve(chip, context);
    },
    consumeNextItemBias() {
      const out = active;
      active = null;
      return out;
    },
    clear() {
      active = null;
    },
  };
}

export { INTENT_CHIP_IDS, INTENT_CHIP_LABELS };
export type { IntentChipId };
