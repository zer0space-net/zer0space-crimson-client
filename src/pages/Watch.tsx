import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { api, type Kind, type StreamLine, type WatchLine } from "../lib/api";
import { useAccount } from "../lib/useAccount";
import { useI18n } from "../lib/i18n";
import { preferredIndex } from "../lib/prefs";
import CrimsonPlayer from "../components/CrimsonPlayer";

// Consumes the progressive /watch NDJSON: each source is surfaced as a chip the
// moment it resolves. The first to arrive starts playing, unless the viewer set a
// preferred audio language — then a matching source is auto-selected when it lands
// (until they pick one by hand). The stream stays open so later (often
// higher-quality) sources keep filling in.
export default function Watch() {
  const { t } = useI18n();
  const { kind = "show", id = "0" } = useParams();
  const [params] = useSearchParams();
  const season = Number(params.get("s") ?? "1");
  const episode = Number(params.get("e") ?? "1");

  const [sources, setSources] = useState<StreamLine[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<
    "loading" | "streaming" | "done" | "error" | "unaired"
  >("loading");
  const [title, setTitle] = useState<string>("");
  const [airDate, setAirDate] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const userPicked = useRef(false);

  const numId = Number(id);
  const path =
    kind === "movie" ? api.watchMovie(numId) : api.watchEpisode(numId, season, episode);

  useEffect(() => {
    const ac = new AbortController();
    seen.current = new Set();
    userPicked.current = false;
    setSources([]);
    setActive(0);
    setStatus("loading");

    (async () => {
      try {
        for await (const line of api.watch(path, ac.signal) as AsyncGenerator<WatchLine>) {
          if (line.type === "meta") {
            if (line.title) setTitle(line.title);
            setStatus("streaming");
          } else if (line.type === "unaired") {
            setAirDate(line.air_date);
            setStatus("unaired");
          } else if (line.type === "stream") {
            const key = `${line.source}|${line.url}`;
            if (seen.current.has(key)) continue;
            seen.current.add(key);
            setSources((prev) => [...prev, line]);
          } else if (line.type === "done") {
            setStatus((s) => (s === "unaired" ? s : "done"));
          }
        }
        setStatus((s) => (s === "error" ? s : "done"));
      } catch {
        if (!ac.signal.aborted) setStatus("error");
      }
    })();

    // In parallel, resolve sources client-side (E1–E3). Merged + deduped against
    // the backend's; if nothing runs client-side, the backend stream is the floor.
    (async () => {
      try {
        const { clientStreams } = await import("../lib/clientSources");
        for await (const line of clientStreams(kind as Kind, numId, season, episode, ac.signal)) {
          const sl: StreamLine = { ...line, origin: "client" };
          const key = `${sl.source}|${sl.url}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          setSources((prev) => [...prev, sl]);
        }
      } catch {
        /* client engine is best-effort */
      }
    })();

    return () => ac.abort();
  }, [path]);

  // Honour the preferred audio language: auto-select a matching source as tiles
  // arrive, until the viewer overrides it by clicking one.
  useEffect(() => {
    if (userPicked.current || sources.length === 0) return;
    const i = preferredIndex(sources);
    if (i >= 0 && i !== active) setActive(i);
  }, [sources, active]);

  const accountAvailable = useAccount();
  const saveProgress = useCallback(
    (position: number, duration: number) => {
      if (accountAvailable !== true) return;
      const isMovie = kind === "movie";
      api
        .saveProgress({
          tmdb_id: numId,
          season_number: isMovie ? undefined : season,
          episode_number: isMovie ? undefined : episode,
          media_type: isMovie ? "movie" : undefined,
          title: title || undefined,
          position_seconds: position,
          duration_seconds: duration,
        })
        .catch(() => {
          /* best-effort */
        });
    },
    [accountAvailable, kind, numId, season, episode, title],
  );

  const current = sources[active];
  const backHref = kind === "movie" ? `/title/movie/${numId}` : `/title/${kind}/${numId}`;

  return (
    <>
      <div className="page-head row gap-14" style={{ alignItems: "baseline" }}>
        <div>
          <Link to={backHref} className="faint" style={{ fontSize: "0.82rem" }}>
            ← {t("common.back")}
          </Link>
          <h1 style={{ fontSize: "1.4rem", marginTop: 4 }}>
            {title || t("watch.title")}
            {kind !== "movie" && (
              <span className="faint" style={{ fontSize: "0.9rem", marginLeft: 10 }}>
                S{season} · E{episode}
              </span>
            )}
          </h1>
        </div>
      </div>

      {current ? (
        <CrimsonPlayer source={current} onProgress={saveProgress} />
      ) : (
        <div className="player-stage">
          <div className="player-empty">
            {status === "error" ? (
              <span>{t("watch.noSourceReachable")}</span>
            ) : status === "unaired" ? (
              <span>
                {t("watch.unaired")}
                {airDate ? ` — ${t("watch.unairedFor")} ${airDate}` : ""}.
              </span>
            ) : status === "done" ? (
              <span>{t("watch.noSourceFound")}</span>
            ) : (
              <div className="row gap-10">
                <div className="spinner spin" />
                <span>{t("watch.resolving")}</span>
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
              onClick={() => {
                userPicked.current = true;
                setActive(i);
              }}
            >
              <span>{s.source}</span>
              {s.language && <span className="lang">{s.language}</span>}
              <span className="source-origin">
                {s.origin === "client" ? t("watch.local") : s.streamType}
              </span>
            </button>
          ))}
        </div>
      )}

      {status === "streaming" && sources.length > 0 && (
        <p className="faint" style={{ marginTop: 12, fontSize: "0.82rem" }}>
          {t("watch.moreSources")}
        </p>
      )}
    </>
  );
}
