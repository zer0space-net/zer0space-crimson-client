import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { api, type StreamLine, type WatchLine } from "../lib/api";
import CrimsonPlayer from "../components/CrimsonPlayer";

// Consumes the progressive /watch NDJSON: each source is surfaced as a chip the
// moment it resolves, and the first to arrive starts playing. The stream stays
// open in the background so later (often higher-quality) sources keep filling in.
export default function Watch() {
  const { kind = "show", id = "0" } = useParams();
  const [params] = useSearchParams();
  const season = Number(params.get("s") ?? "1");
  const episode = Number(params.get("e") ?? "1");

  const [sources, setSources] = useState<StreamLine[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<"loading" | "streaming" | "done" | "error">("loading");
  const [title, setTitle] = useState<string>("");
  const seen = useRef(new Set<string>());

  const numId = Number(id);
  const path =
    kind === "movie" ? api.watchMovie(numId) : api.watchEpisode(numId, season, episode);

  useEffect(() => {
    const ac = new AbortController();
    seen.current = new Set();
    setSources([]);
    setActive(0);
    setStatus("loading");

    (async () => {
      try {
        for await (const line of api.watch(path, ac.signal) as AsyncGenerator<WatchLine>) {
          if (line.type === "meta") {
            if (line.title) setTitle(line.title);
            setStatus("streaming");
          } else if (line.type === "stream") {
            const key = `${line.source}|${line.url}`;
            if (seen.current.has(key)) continue;
            seen.current.add(key);
            setSources((prev) => [...prev, line]);
          } else if (line.type === "done") {
            setStatus("done");
          }
        }
        setStatus((s) => (s === "error" ? s : "done"));
      } catch (err) {
        if (!ac.signal.aborted) setStatus("error");
      }
    })();

    return () => ac.abort();
  }, [path]);

  const current = sources[active];
  const backHref =
    kind === "movie" ? `/title/movie/${numId}` : `/title/${kind}/${numId}`;

  return (
    <>
      <div className="page-head row gap-14" style={{ alignItems: "baseline" }}>
        <div>
          <Link to={backHref} className="faint" style={{ fontSize: "0.82rem" }}>
            ← Zurück
          </Link>
          <h1 style={{ fontSize: "1.4rem", marginTop: 4 }}>
            {title || "Wiedergabe"}
            {kind !== "movie" && (
              <span className="faint" style={{ fontSize: "0.9rem", marginLeft: 10 }}>
                S{season} · E{episode}
              </span>
            )}
          </h1>
        </div>
      </div>

      {current ? (
        <CrimsonPlayer source={current} />
      ) : (
        <div className="player-stage">
          <div className="player-empty">
            {status === "error" ? (
              <span>Keine Quelle erreichbar.</span>
            ) : (
              <div className="row gap-10">
                <div className="spinner spin" />
                <span>Quellen werden aufgelöst …</span>
              </div>
            )}
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="source-list">
          {sources.map((s, i) => (
            <button
              key={`${s.source}-${i}`}
              type="button"
              className={"source-chip" + (i === active ? " is-active" : "")}
              onClick={() => setActive(i)}
            >
              <span>{s.source}</span>
              {s.language && <span className="lang">{s.language}</span>}
              {s.quality && <span className="lang">{s.quality}</span>}
              <span className="source-origin">{s.origin === "client" ? "lokal" : s.streamType}</span>
            </button>
          ))}
        </div>
      )}

      {status === "streaming" && sources.length > 0 && (
        <p className="faint" style={{ marginTop: 12, fontSize: "0.82rem" }}>
          Weitere Quellen werden noch gesucht …
        </p>
      )}
    </>
  );
}
