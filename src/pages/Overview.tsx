import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type Kind } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useI18n } from "../lib/i18n";
import { Spinner, ErrorBox, Rail } from "../components/ui";
import FavoriteButton from "../components/FavoriteButton";

type Avail = { loading: boolean; audio: string[]; sub: string[] };

const LANG_ORDER = ["de", "en", "ja"];
function classifyLang(label: string): string | null {
  const l = label.toLowerCase();
  if (/german|deutsch|ger/.test(l)) return "de";
  if (/english|eng/.test(l)) return "en";
  if (/japan|jpn|ja\b/.test(l)) return "ja";
  return null;
}
const LANG_LABEL: Record<string, string> = { de: "DE", en: "EN", ja: "JA" };
const sortLangs = (s: Set<string>) =>
  [...s].sort((a, b) => LANG_ORDER.indexOf(a) - LANG_ORDER.indexOf(b));

// Resolving a season's E1 is a full /watch (all scrapers), so remember the result
// per (tmdb, season) for the session — re-opening a series doesn't hit it again.
const availCache = new Map<string, Avail>();

// Which audio (dub) + subtitle (sub) languages a series offers, discovered by
// resolving the season's first episode in the background (capped, best-effort — the
// player is the source of truth, this is just an at-a-glance hint on the overview).
function useAvailability(
  kind: Kind,
  tmdbId: number | null | undefined,
  season: number | null,
  firstEp: number | undefined,
): Avail {
  const [state, setState] = useState<Avail>({ loading: false, audio: [], sub: [] });
  useEffect(() => {
    if (kind === "movie" || !tmdbId || season == null || !firstEp) {
      setState({ loading: false, audio: [], sub: [] });
      return;
    }
    const cacheKey = `${tmdbId}:${season}`;
    const cached = availCache.get(cacheKey);
    if (cached) {
      setState(cached);
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 14000); // don't hang the badges forever
    const audio = new Set<string>();
    const sub = new Set<string>();
    setState({ loading: true, audio: [], sub: [] });
    (async () => {
      try {
        for await (const line of api.watch(api.watchEpisode(tmdbId, season, firstEp), ac.signal)) {
          if (line.type === "stream" && line.language) {
            const lang = classifyLang(line.language);
            if (!lang) continue;
            const low = line.language.toLowerCase();
            if (low.includes("dub")) audio.add(lang);
            if (low.includes("sub")) sub.add(lang);
            setState({ loading: true, audio: sortLangs(audio), sub: sortLangs(sub) });
          }
        }
      } catch {
        /* aborted / network — keep whatever we collected */
      } finally {
        const final = { loading: false, audio: sortLangs(audio), sub: sortLangs(sub) };
        // Only cache a completed, non-aborted resolve that actually found something.
        if (!ac.signal.aborted && (final.audio.length || final.sub.length)) {
          availCache.set(cacheKey, final);
        }
        setState(final);
      }
    })();
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [kind, tmdbId, season, firstEp]);
  return state;
}

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

  // "Similar to" — AniList-keyed, so anime titles only.
  const similar = useAsync(
    (s) =>
      data?.anilist_id ? api.similar(data.anilist_id, s) : Promise.resolve([]),
    [data?.anilist_id],
  );

  // Language/version availability for the chosen season (resolves E1 in the bg).
  const firstEp = eps.data?.episodes_list?.[0]?.episode_number;
  const avail = useAvailability(kind as Kind, data?.tmdb_id ?? null, season, firstEp);

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

          {(avail.audio.length > 0 || avail.sub.length > 0 || avail.loading) && (
            <div className="avail-row">
              {avail.audio.length > 0 && (
                <span className="row gap-8" style={{ alignItems: "center" }}>
                  <span className="avail-label">{t("ov.audio")}:</span>
                  <span className="avail-badges">
                    {avail.audio.map((l) => (
                      <span key={l} className={`avail-badge is-${l}`}>
                        {LANG_LABEL[l]}
                      </span>
                    ))}
                  </span>
                </span>
              )}
              {avail.sub.length > 0 && (
                <span className="row gap-8" style={{ alignItems: "center" }}>
                  <span className="avail-label">{t("ov.subs")}:</span>
                  <span className="avail-badges">
                    {avail.sub.map((l) => (
                      <span key={l} className={`avail-badge is-${l}`}>
                        {LANG_LABEL[l]}
                      </span>
                    ))}
                  </span>
                </span>
              )}
              {avail.loading && avail.audio.length === 0 && avail.sub.length === 0 && (
                <span className="avail-spin">
                  <span className="spinner spin" />
                  {t("watch.resolving")}
                </span>
              )}
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
                  {avail.audio.length > 0 && (
                    <span className="episode-avail" aria-hidden="true">
                      {avail.audio.map((l) => (
                        <span key={l} className={`ea is-${l}`}>
                          {LANG_LABEL[l]}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="faint">▶</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="faint">{t("ov.noEpisodes")}</p>
          )}
        </section>
      )}

      {similar.data && similar.data.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{t("ov.similar")}</h2>
          </div>
          <Rail items={similar.data} />
        </section>
      )}
    </>
  );
}
