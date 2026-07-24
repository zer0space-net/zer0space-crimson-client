import { useEffect, useRef } from "react";
import Hls from "hls.js";
import type { StreamLine } from "../lib/api";

// Renders one resolved source. HLS via hls.js (native HLS on Safari), MP4 in a
// plain <video>, and iframe sources in a sandboxed frame. Subtitle tracks are
// attached when the source carries them.
export default function CrimsonPlayer({ source }: { source: StreamLine }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (source.streamType === "iframe") return;
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    if (source.streamType === "hls") {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = source.url;
      } else if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(source.url);
        hls.attachMedia(video);
      } else {
        video.src = source.url; // last resort
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
        {source.subtitles?.map((t, i) => (
          <track
            key={i}
            kind="subtitles"
            src={t.url}
            label={t.label || t.lang || `Sub ${i + 1}`}
            srcLang={t.lang}
            default={i === 0}
          />
        ))}
      </video>
    </div>
  );
}
