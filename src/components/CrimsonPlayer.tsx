import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { StreamLine, SkipTimes, SubtitleTrack } from "../lib/api";
import { useI18n } from "../lib/i18n";

// Renders one resolved source. HLS via hls.js (native HLS on Safari), MP4 in a
// plain <video>, and iframe sources in a sandboxed frame. Subtitle tracks (from
// the source and any external ones) are attached as <track>; `skip` intervals
// surface a Skip-intro / Skip-outro button; `onProgress` fires (throttled) so the
// host can persist watch progress. iframe sources are opaque — no tracks, no skip,
// no progress.
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

  const tracks: SubtitleTrack[] = [...(source.subtitles ?? []), ...(extraSubtitles ?? [])];

  useEffect(() => {
    if (source.streamType === "iframe") return;
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    if (source.streamType === "hls") {
      // Prefer hls.js wherever it's supported (Chrome/Firefox/Edge). Trusting
      // canPlayType('application/vnd.apple.mpegurl') first was the bug: some Chrome
      // builds answer "maybe", so the m3u8 was handed to the native element, which
      // can't actually play HLS → MEDIA_ELEMENT_ERROR "Format error" (grey player).
      // Native HLS is only the right path on Safari, where hls.js isn't supported.
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(source.url);
        hls.attachMedia(video);
      } else {
        video.src = source.url; // Safari (native HLS) / last resort
      }
    } else {
      video.src = source.url;
    }
    video.play().catch(() => {
      /* autoplay may be blocked; the controls remain */
    });

    return () => {
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
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
      <video ref={videoRef} controls playsInline crossOrigin="anonymous">
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
