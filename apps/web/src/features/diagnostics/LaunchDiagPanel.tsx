"use client";

import type { AnalyticsTransport } from "@project-flow/analytics";
import { useEffect, useState, type ReactElement } from "react";

import {
  getLaunchDiagnostics,
  subscribeLaunchDiagnostics,
  type LaunchDiagnosticsSnapshot,
} from "./launchDiagnostics";

type LaunchDiagPanelProps = {
  onClose: () => void;
  transport: AnalyticsTransport;
};

/**
 * DEV-only launch diagnostics. Never mount in production unless NEXT_PUBLIC_ENABLE_DIAG=1.
 */
export function LaunchDiagPanel({
  onClose,
  transport,
}: LaunchDiagPanelProps): ReactElement | null {
  const [snap, setSnap] = useState<LaunchDiagnosticsSnapshot>(() =>
    getLaunchDiagnostics(),
  );
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeLaunchDiagnostics(() => setSnap(getLaunchDiagnostics())), []);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENABLE_DIAG !== "1") {
    return null;
  }

  const diag = transport.getDiagnostics();
  void tick;

  return (
    <aside
      style={{
        position: "absolute",
        left: 8,
        top: 8,
        zIndex: 50,
        maxWidth: 320,
        maxHeight: "70%",
        overflow: "auto",
        padding: 10,
        borderRadius: 8,
        background: "rgba(8,8,10,0.92)",
        color: "#e8e4dc",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10,
        lineHeight: 1.35,
        border: "1px solid rgba(255,255,255,0.12)",
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <strong>L1.5 DIAG</strong>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#e8e4dc",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>
      <Section title="CONTENT">
        <Row k="content" v={snap.contentId} />
        <Row k="series" v={snap.seriesId} />
        <Row k="episode" v={snap.episodeId} />
        <Row k="status" v={snap.contentStatus} />
        <Row k="dims" v={snap.width && snap.height ? `${snap.width}x${snap.height}` : null} />
        <Row k="aspect" v={snap.aspectRatio?.toFixed(3) ?? null} />
        <Row k="captions" v={`${snap.captionTracks} tracks · on=${String(snap.captionsOn)}`} />
      </Section>
      <Section title="PLAYBACK">
        <Row k="state" v={snap.playerState} />
        <Row k="t" v={`${Math.round(snap.currentTimeMs)} / ${Math.round(snap.durationMs)} ms`} />
        <Row k="autoplay" v={`tried=${String(snap.autoplayAttempted)} blocked=${String(snap.autoplayBlocked)}`} />
        <Row k="src" v={snap.sourceUri} />
        <Row k="prefetch" v={snap.prefetchIds.join(",") || "—"} />
      </Section>
      <Section title="SESSION">
        <Row k="anon" v={snap.anonymousUserId} />
        <Row k="session" v={snap.sessionId} />
        <Row k="resume" v={snap.resumePositionMs != null ? `${snap.resumePositionMs}ms` : "—"} />
      </Section>
      <Section title="ANALYTICS">
        <Row k="transport" v={diag.transportType} />
        <Row k="queue" v={String(diag.queueSize)} />
        <Row k="last" v={diag.lastEventName} />
        <Row k="flush" v={diag.lastFlushAt} />
        <Row k="fails" v={String(diag.failedSends)} />
      </Section>
      <Section title="PERFORMANCE">
        <Row k="page_start" v={snap.pageStartTs != null ? String(Math.round(snap.pageStartTs)) : "—"} />
        <Row k="content_open" v={snap.contentOpenTs != null ? String(snap.contentOpenTs) : "—"} />
        <Row k="play_attempt" v={snap.playAttemptTs != null ? String(snap.playAttemptTs) : "—"} />
        <Row k="fmp" v={snap.firstMeaningfulPlayTs != null ? String(Math.round(snap.firstMeaningfulPlayTs)) : "—"} />
        <Row k="ttfp_ms" v={snap.timeToFirstPlayMs != null ? String(Math.round(snap.timeToFirstPlayMs)) : "—"} />
      </Section>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ opacity: 0.55, marginBottom: 2 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }): ReactElement {
  return (
    <div style={{ wordBreak: "break-all" }}>
      <span style={{ opacity: 0.65 }}>{k}: </span>
      {v ?? "—"}
    </div>
  );
}
