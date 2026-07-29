import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type Kind } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useI18n } from "../lib/i18n";
import { Spinner, ErrorBox } from "../components/ui";
import FavoriteButton from "../components/FavoriteButton";

// AniList descriptions arrive as HTML; the overview UI renders plain text, so
// strip tags rather than dangerouslySetInnerHTML. Prefer the plain TMDB summary.
function plain(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

export default function Overview() {
  const { t } = useI18n();
  const { kind = "show", id = "0" } = useParams<{ kind: Kind; id: string }>();
  const numId = Number(id);
  const { data, loading, error } = useAsync(
    (s) => api.overview(kind as Kind, numId, s),
    [kind, id],
  );

  const seasons = data?.seasons ?? [];
  const [season, setSeason] = useState<number | null>(null);
  // Default to the first real season once the overview loads.
  useEffect(() => {
    if (seasons.length) setSeason((cur) => cur ?? seasons[0].season_number);
  }, [seasons]);

  // Episodes are not in the overview — fetch them for the chosen season.
  const eps = useAsync(
    (s) =>
      data && season != null && kind !== "movie"
        ? api.seasonEpisodes(data.tmdb_id, season, s)
        : Promise.resolve(null),
    [data?.tmdb_id, season, kind],
  );

  if (loading) return <Spinner label={t("ov.loading")} />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const synopsis = data.summary?.trim() || plain(data.description);
  const year = data.year ? String(data.year).slice(0, 4) : null;

  return (
    <>
      <div className="overview-hero">
        <div className="overview-poster">
          {data.poster ? (
            <img src={data.poster} alt="" />
          ) : (
            <div className="poster-img ph">{data.title}</div>
          )}
        </div>
        <div>
          <h1 className="overview-title">{data.title}</h1>
          <div className="row gap-10 faint" style={{ fontSize: "0.86rem" }}>
            {year && <span>{year}</span>}
            {data.status && <span>· {data.status}</span>}
            {kind === "anime" && <span className="badge badge-accent">{t("common.anime")}</span>}
            {data.degraded && <span className="badge">{t("ov.degraded")}</span>}
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

          {synopsis && <p className="overview-synopsis">{synopsis}</p>}

          <div className="row gap-10" style={{ marginTop: 22, flexWrap: "wrap" }}>
            {kind === "movie" && (
              <Link className="btn btn-primary" to={`/watch/movie/${data.tmdb_id}`}>
                {t("common.play")}
              </Link>
            )}
            <FavoriteButton
              kind={kind as Kind}
              tmdbId={data.tmdb_id}
              anilistId={data.anilist_id}
              title={data.title}
              poster={data.poster}
            />
          </div>
        </div>
      </div>

      {kind !== "movie" && seasons.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{t("ov.episodes")}</h2>
          </div>

          {seasons.length > 1 && (
            <div className="season-tabs">
              {seasons.map((s) => (
                <button
                  key={s.season_number}
                  type="button"
                  className={
                    "btn btn-sm " + (season === s.season_number ? "btn-primary" : "btn-ghost")
                  }
                  onClick={() => setSeason(s.season_number)}
                >
                  {s.name || t("ov.season", { n: s.season_number })}
                </button>
              ))}
            </div>
          )}

          {eps.loading ? (
            <Spinner label={t("ov.epLoading")} />
          ) : eps.data && eps.data.episodes_list.length > 0 ? (
            <div className="episode-list">
              {eps.data.episodes_list.map((ep) => (
                <Link
                  key={ep.episode_number}
                  className="episode-row"
                  to={`/watch/${kind}/${data.tmdb_id}?s=${season}&e=${ep.episode_number}`}
                >
                  <span className="episode-num">
                    {String(ep.episode_number).padStart(2, "0")}
                  </span>
                  <span className="episode-title">
                    {ep.title || `Episode ${ep.episode_number}`}
                  </span>
                  <span className="faint">▶</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="faint">{t("ov.noEpisodes")}</p>
          )}
        </section>
      )}
    </>
  );
}
