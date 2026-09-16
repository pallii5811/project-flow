import type { AnalyticsEnvelope, AnalyticsEventName } from "./types";
import { LAUNCH_EVENT_NAME_SET } from "./launchEvents";

export type EnvelopeValidationIssue = {
  code: string;
  path: string;
  message: string;
};

const REQUIRED_STRING = [
  "event_id",
  "event_name",
  "timestamp",
  "anonymous_user_id",
  "session_id",
] as const;

/**
 * DEV/test schema check for the L1 envelope.
 * Returns issues; never throws (callers decide).
 */
export function validateAnalyticsEnvelope(
  raw: unknown,
): EnvelopeValidationIssue[] {
  const issues: EnvelopeValidationIssue[] = [];
  if (typeof raw !== "object" || raw === null) {
    return [{ code: "not_object", path: "", message: "Envelope must be an object" }];
  }
  const row = raw as Record<string, unknown>;
  for (const key of REQUIRED_STRING) {
    if (typeof row[key] !== "string" || (row[key] as string).length === 0) {
      issues.push({
        code: "missing_field",
        path: key,
        message: `${key} must be a non-empty string`,
      });
    }
  }
  if (typeof row.timestamp === "string" && Number.isNaN(Date.parse(row.timestamp))) {
    issues.push({
      code: "invalid_timestamp",
      path: "timestamp",
      message: "timestamp must be ISO-8601",
    });
  }
  if (typeof row.event_name === "string" && row.event_name.length === 0) {
    issues.push({
      code: "invalid_event",
      path: "event_name",
      message: "event_name empty",
    });
  }
  return issues;
}

export function assertValidEnvelopeInDev(envelope: AnalyticsEnvelope): void {
  if (process.env.NODE_ENV === "production") return;
  const issues = validateAnalyticsEnvelope(envelope);
  if (issues.length === 0) return;
  console.warn("[analytics] envelope schema issues", issues, envelope.event_name);
}

export function isLaunchEventName(name: string): boolean {
  return LAUNCH_EVENT_NAME_SET.has(name);
}

export function asEventName(name: string): AnalyticsEventName {
  return name as AnalyticsEventName;
}
