import type { FeedCatalogPayload } from "@project-flow/feed-domain";
import type { ReactElement } from "react";
import { preload } from "react-dom";

import { buildHlsWarmupScript, isHlsSource } from "@/features/player/hlsSupport";

import { FeedApp } from "./FeedApp";

type FeedDocumentProps = {
  /** Target episode and the one after it — everything the first frame needs. */
  initial: FeedCatalogPayload;
  initialContentId?: string;
  deepLinkRoute?: string;
};

/**
 * Server side of a feed page: warms what the first frame needs while the
 * JavaScript downloads, then renders the feed with only the first-frame slides.
 */
export function FeedDocument({
  initial,
  initialContentId,
  deepLinkRoute,
}: FeedDocumentProps): ReactElement {
  const first = initial.items[0];
  if (first) {
    preload(first.playback.posterReference, { as: "image", fetchPriority: "high" });
  }
  const warmup =
    first && isHlsSource(first.playback.mimeType, first.playback.reference)
      ? buildHlsWarmupScript([first.playback.reference])
      : null;

  return (
    <>
      {warmup ? <script dangerouslySetInnerHTML={{ __html: warmup }} /> : null}
      <FeedApp
        initial={initial}
        initialContentId={initialContentId}
        deepLinkRoute={deepLinkRoute}
      />
    </>
  );
}
