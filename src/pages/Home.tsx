import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type MediaCard, type ProgressItem } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useAccount } from "../lib/useAccount";
import { useI18n } from "../lib/i18n";
import { Spinner, ErrorBox, Rail, PosterGrid } from "../components/ui";
import NewsTicker from "../components/NewsTicker";

type BrowseCat = "all" | "anime" | "series" | "movie";

function yearOf(m: MediaCard): number {
  const y = typeof m.year === "string" ? parseInt(m.year, 10) : m.year;
  return typeof y === "number" && !Number.isNaN(y) ? y : 0;
}

// Round-robin merge so the "all" view mixes types instead of listing every anime
// first.
function interleave(...lists: MediaCard[][]): MediaCard[] {
  const out: MediaCard[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

// The Netflix/Crunchyroll-style browse strip: New / Popular tabs + category chips
// over a responsive poster grid. Popular keeps the trending order; New sorts by
// year (freshest first).
function Browse({
  anime,
  shows,
  movies,
}: {
  anime: MediaCard[];
  shows: MediaCard[];
  movies: MediaCard[];
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"popular" | "new">("popular");
  const [cat, setCat] = useState<BrowseCat>("all");

  const items = useMemo(() => {
    let pool =
      cat === "anime" ? anime : cat === "series" ? shows : cat === "movie" ? movies
      : interleave(anime, shows, movies);
    if (tab === "new") pool = [...pool].sort((a, b) => yearOf(b) - yearOf(a));
    return pool;
  }, [anime, shows, movies, tab, cat]);

  const cats: BrowseCat[] = ["all", "anime", "series", "movie"];
  const catKey: Record<BrowseCat, string> = {
    all: "news.all",
    anime: "news.anime",
    series: "news.series",
    movie: "news.movies",
  };

  if (!items.length) return null;

  return (
    <section className="section browse">
      <div className="browse-bar">
        <div className="browse-tabs">
          <button type="button" aria-pressed={tab === "new"} onClick={() => setTab("new")}>
            {t("browse.new")}
          </button>
          <button type="button" aria-pressed={tab === "popular"} onClick={() => setTab("popular")}>
            {t("browse.popular")}
          </button>
        </div>
        <label className="browse-drop">
          <span className="browse-drop-label">{t("browse.filter")}</span>
          <select
            className="input browse-select"
            value={cat}
            onChange={(e) => setCat(e.target.value as BrowseCat)}
            aria-label={t("browse.filter")}
          >
            {cats.map((c) => (
              <option key={c} value={c}>
                {t(catKey[c])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <PosterGrid items={items} />
    </section>
  );
}

// A continue-watching card resumes at the saved episode; the watch route is
// TMDB-keyed, so an item without a tmdb id falls back to nothing (skipped).
function resumeHref(it: ProgressItem): string | null {
  if (it.media_type === "movie" && it.tmdb_id) return `/watch/movie/${it.tmdb_id}`;
  if (it.tmdb_id && it.season_number != null && it.episode_number != null)
    return `/watch/show/${it.tmdb_id}?s=${it.season_number}&e=${it.episode_number}`;
  return null;
}

function ContinueWatching() {
  const available = useAccount();
  const { t } = useI18n();
  const { data } = useAsync(
    (s) => (available === true ? api.continueWatching(s) : Promise.resolve([])),
    [available],
  );
  if (available !== true || !data || data.length === 0) return null;

  return (
    <section className="section">
      <div className="section-head">
        <h2>{t("home.continue")}</h2>
      </div>
      <div className="rail">
        {data.map((it, i) => {
          const href = resumeHref(it);
          const pct =
            it.position_seconds && it.duration_seconds && it.duration_seconds > 0
              ? Math.min(100, Math.round((it.position_seconds / it.duration_seconds) * 100))
              : 0;
          const inner = (
            <>
              <div className="poster-img">
                {it.poster ? <img src={it.poster} alt="" loading="lazy" /> : <div className="ph">{it.title}</div>}
                {pct > 0 && (
                  <div className="resume-bar" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              <div className="poster-title" title={it.title ?? ""}>
                {it.title}
              </div>
              {it.season_number != null && it.episode_number != null && (
                <div className="poster-meta">
                  S{it.season_number} · E{it.episode_number}
                </div>
              )}
            </>
          );
          return href ? (
            <Link key={i} className="poster" to={href}>
              {inner}
            </Link>
          ) : (
            <div key={i} className="poster">
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ForYou() {
  const available = useAccount();
  const { t } = useI18n();
  const { data } = useAsync(
    (s) => (available === true ? api.recommendations(s) : Promise.resolve([])),
    [available],
  );
  if (available !== true || !data || data.length === 0) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>{t("home.forYou")}</h2>
      </div>
      <Rail items={data} />
    </section>
  );
}

export default function Home() {
  const { t } = useI18n();
  const trending = useAsync((s) => api.trending("anime", s), []);
  const shows = useAsync((s) => api.trending("show", s), []);
  const movies = useAsync((s) => api.trending("movie", s), []);

  if (trending.loading && shows.loading && movies.loading)
    return <Spinner label={t("common.loading")} />;
  if (trending.error && shows.error && movies.error) return <ErrorBox error={trending.error} />;

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{t("home.eyebrow")}</span>
        <h1>{t("home.title")}</h1>
        <p>{t("home.sub")}</p>
      </div>

      <NewsTicker />

      <Browse
        anime={trending.data ?? []}
        shows={shows.data ?? []}
        movies={movies.data ?? []}
      />

      <ContinueWatching />
      <ForYou />
    </>
  );
}
