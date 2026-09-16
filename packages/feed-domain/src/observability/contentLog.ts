/**
 * Observability helpers — structured, small logs. Never dump full catalogs.
 */

export type ContentLogEvent =
  | "content_resolved"
  | "playback_resolved"
  | "caption_resolved"
  | "playback_failed"
  | "content_rejected";

export type ContentLogFields = {
  event: ContentLogEvent;
  contentId?: string;
  seriesId?: string;
  code?: string;
  detail?: string;
};

export function logContentEvent(
  fields: ContentLogFields,
  sink: (line: string) => void = defaultSink,
): void {
  const parts = [
    `[content] ${fields.event}`,
    fields.contentId ? `content=${fields.contentId}` : null,
    fields.seriesId ? `series=${fields.seriesId}` : null,
    fields.code ? `code=${fields.code}` : null,
    fields.detail ? `detail=${fields.detail}` : null,
  ].filter(Boolean);
  sink(parts.join(" "));
}

function defaultSink(line: string): void {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console -- intentional structured dev observability
  console.info(line);
}
