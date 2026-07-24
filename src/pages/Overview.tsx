import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type Overview as OverviewData } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Spinner, ErrorBox } from "../components/ui";

type Kind = "show" | "movie" | "anime";

function fetchOverview(kind: Kind, id: number, signal: AbortSignal): Promise<OverviewData> {
  if (kind === "movie") return api.movieOverview(id, signal);
  if (kind === "anime") return api.animeOverview(id, signal);
  return api.showOverview(id, signal);
}

export default function Overview() {
  const { kind = "show", id = "0" } = useParams<{ kind: Kind; id: string }>();
  const numId = Number(id);
  const { data, loading, error } = useAsync(
    (s) => fetchOverview(kind as Kind, numId, s),
    [kind, id],
  );
  const [season, setSeason] = useState(1);

  if (loading) return <Spinner label="Lade Titel …" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const seasons = data.seasons ?? [];
  const active = seasons.find((s) => s.number === season) ?? seasons[0];
  const year = data.year ? String(data.year).slice(0, 4) : null;

  return (
    <>
      <div className="overview-hero">
        <div className="overview-poster">
          {data.poster ? <img src={data.poster} alt="" /> : <div className="poster-img ph">{data.title}</div>}
        </div>
        <div>
          <h1 className="overview-title">{data.title}</h1>
          <div className="row gap-10 faint" style={{ fontSize: "0.86rem" }}>
            {year && <span>{year}</span>}
            {data.status && <span>· {data.status}</span>}
            {kind === "anime" && <span className="badge badge-accent">Anime</span>}
          </div>

          {data.genres && data.genres.length > 0 && (
            <div className="overview-tags">
              {data.genres.map((g) => (
                <span key={g} className="badge">
                  {g}
                </span>
              ))}
            </div>
          )}

          {data.synopsis && <p className="overview-synopsis">{data.synopsis}</p>}

          {kind === "movie" && (
            <div style={{ marginTop: 22 }}>
              <Link className="btn btn-primary" to={`/watch/movie/${numId}`}>
                ▶ Abspielen
              </Link>
            </div>
          )}
        </div>
      </div>

      {kind !== "movie" && seasons.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Episoden</h2>
          </div>

          {seasons.length > 1 && (
            <div className="season-tabs">
              {seasons.map((s) => (
                <button
                  key={s.number}
                  type="button"
                  className={"btn btn-sm " + (active?.number === s.number ? "btn-primary" : "btn-ghost")}
                  onClick={() => setSeason(s.number)}
                >
                  {s.name || `Staffel ${s.number}`}
                </button>
              ))}
            </div>
          )}

          <div className="episode-list">
            {active?.episodes.map((ep) => (
              <Link
                key={ep.number}
                className="episode-row"
                to={`/watch/${kind}/${numId}?s=${active.number}&e=${ep.number}`}
              >
                <span className="episode-num">{String(ep.number).padStart(2, "0")}</span>
                <span className="episode-title">{ep.title || `Episode ${ep.number}`}</span>
                <span className="faint">▶</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
