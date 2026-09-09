import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { StreamLine, SkipTimes, SubtitleTrack } from "../lib/api";
import { useI18n } from "../lib/i18n";
import {
  canPickTarget,
  isSameOrigin,
  mediaToken,
  prefersNativeHls,
  showTargetPicker,
  withToken,
} from "../lib/airplay";

// Renders one resolved source. HLS via hls.js (native HLS on Safari), MP4 in a
// plain <video>, and iframe sources in a sandboxed frame. Subtitle tracks (from
// the source and any external ones) are attached as <track>; `skip` intervals
// surface a Skip-intro / Skip-outro button; `onProgress` fires (throttled) so the
// host can persist watch progress. iframe sources are opaque — no tracks, no skip,
// no progress, and no AirPlay.
export default function CrimsonPlayer({
  source,
  onProgress,
  skip,
  extraSubtitles,
}: {
  source: StreamLine;
  onProgress?: (position: number, duration: number) => void;
  skip?: SkipTimes | null;
  extraSubtitles?: SubtitleTrack[];
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [skipTo, setSkipTo] = useState<{ label: string; to: number } | null>(null);
  const [routeAvailable, setRouteAvailable] = useState(false);
  // The URL of a source Safari's own HLS stack refused, so the load effect can
  // retry that one through hls.js instead. Keyed by URL rather than a flag: it
  // must not carry over when the viewer switches source.
  const [nativeRefused, setNativeRefused] = useState<string | null>(null);

  const tracks: SubtitleTrack[] = [...(source.subtitles ?? []), ...(extraSubtitles ?? [])];
  // Only needed for cross-origin subtitle files. On the native path it is worse
  // than useless: a CDN that sends no CORS headers refuses the request outright
  // and the video never starts.
  const needsCors = tracks.some((tr) => !isSameOrigin(tr.url));

  useEffect(() => {
    if (source.streamType === "iframe") return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let hls: Hls | null = null;
    let onNativeError: (() => void) | null = null;

    // hls.js runs off MediaSource, which Safari can only screen-mirror — so on
    // Apple's stack the URL goes into video.src and Safari's own HLS stack takes
    // it, which is what makes real AirPlay (the TV playing at its own aspect
    // ratio and resolution) possible at all.
    const native =
      source.streamType !== "hls" ||
      (nativeRefused !== source.url && prefersNativeHls(video, Hls.isSupported()));

    (async () => {
      let url = source.url;
      if (native && isSameOrigin(url)) {
        // The receiver fetches this URL from a device with no session cookie.
        url = withToken(url, await mediaToken());
        if (cancelled) return;
      }

      if (native) {
        video.src = url;
        // Safari occasionally refuses a playlist hls.js would have played. Rather
        // than trading the old grey player for a new one, that source is retried
        // through hls.js — AirPlay is then mirror-only for it, but it plays.
        if (source.streamType === "hls" && Hls.isSupported()) {
          onNativeError = () => {
            if (!cancelled) setNativeRefused(source.url);
          };
          video.addEventListener("error", onNativeError, { once: true });
        }
      } else if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else {
        video.src = url; // last resort
      }
      video.play().catch(() => {
        /* autoplay may be blocked; the controls remain */
      });
    })();

    return () => {
      cancelled = true;
      // Before the src is cleared: emptying a <video> fires its own error, which
      // must not be read as "Safari refused this playlist".
      if (onNativeError) video.removeEventListener("error", onNativeError);
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [source, nativeRefused]);

  // Surface an AirPlay button as soon as Safari reports a receiver on the network.
  // The native fullscreen controls carry one too, but it is easy to miss and only
  // appears there once the video is playing.
  useEffect(() => {
    if (source.streamType === "iframe") return;
    const video = videoRef.current;
    if (!video || !canPickTarget(video)) return;
    // Pre-Safari-13 spelling of "this video may be AirPlayed"; a no-op since, and
    // set here rather than in JSX because React has no typed attribute for it.
    video.setAttribute("x-webkit-airplay", "allow");
    const onAvailability = (e: Event) => {
      setRouteAvailable((e as unknown as { availability?: string }).availability === "available");
    };
    video.addEventListener("webkitplaybacktargetavailabilitychanged", onAvailability);
    return () =>
      video.removeEventListener("webkitplaybacktargetavailabilitychanged", onAvailability);
  }, [source]);

  // Throttled progress reporting + skip-button state, both off one timeupdate.
  useEffect(() => {
    if (source.streamType === "iframe") return;
    const video = videoRef.current;
    if (!video) return;
    let lastProgress = 0;
    const onTime = () => {
      const now = Date.now();
      if (onProgress && video.duration && !Number.isNaN(video.duration) && now - lastProgress >= 15000) {
        lastProgress = now;
        onProgress(video.currentTime, video.duration);
      }
      const ct = video.currentTime;
      const inRange = (iv: { start: number; end: number } | null | undefined) =>
        iv && ct >= iv.start && ct < iv.end - 0.3;
      if (inRange(skip?.op)) setSkipTo({ label: t("watch.skipIntro"), to: skip!.op!.end });
      else if (inRange(skip?.ed)) setSkipTo({ label: t("watch.skipOutro"), to: skip!.ed!.end });
      else setSkipTo(null);
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [source, onProgress, skip, t]);

  if (source.streamType === "iframe") {
    return (
      <div className="player-stage">
        <iframe
          src={source.url}
          allowFullScreen
          allow="autoplay; encrypted-media; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
          referrerPolicy="no-referrer"
          title={source.source}
        />
      </div>
    );
  }

  return (
    <div className="player-stage">
      <video
        ref={videoRef}
        controls
        playsInline
        crossOrigin={needsCors ? "anonymous" : undefined}
      >
        {tracks.map((t2, i) => (
          <track
            key={`${t2.url}-${i}`}
            kind="subtitles"
            src={t2.url}
            label={t2.label || t2.lang || `Sub ${i + 1}`}
            srcLang={t2.lang}
          />
        ))}
      </video>
      {routeAvailable && (
        <button
          type="button"
          className="airplay-btn"
          onClick={() => {
            const v = videoRef.current;
            if (v) showTargetPicker(v);
          }}
          title={t("watch.airplay")}
          aria-label={t("watch.airplay")}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M4 17V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <path d="M12 14l5 6H7l5-6z" fill="currentColor" />
          </svg>
        </button>
      )}
      {skipTo && (
        <button
          type="button"
          className="skip-btn"
          onClick={() => {
            const v = videoRef.current;
            if (v) v.currentTime = skipTo.to;
            setSkipTo(null);
          }}
        >
          {skipTo.label} ⏭
        </button>
      )}
    </div>
  );
}
