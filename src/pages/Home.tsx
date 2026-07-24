import { Link } from "react-router-dom";
import { api, type ProgressItem } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useAccount } from "../lib/useAccount";
import { Spinner, ErrorBox, Rail } from "../components/ui";

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
  const { data } = useAsync(
    (s) => (available === true ? api.continueWatching(s) : Promise.resolve([])),
    [available],
  );
  if (available !== true || !data || data.length === 0) return null;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Weiterschauen</h2>
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

export default function Home() {
  const trending = useAsync((s) => api.trending("anime", s), []);
  const shows = useAsync((s) => api.trending("show", s), []);
  const movies = useAsync((s) => api.trending("movie", s), []);

  if (trending.loading && shows.loading && movies.loading) return <Spinner label="Lade …" />;
  if (trending.error && shows.error && movies.error) return <ErrorBox error={trending.error} />;

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">zer0space ✕ Crimson</span>
        <h1>Was läuft gerade</h1>
        <p>Angetrieben vom Crimson-Haven-Backend, im zer0space-Universum.</p>
      </div>

      <ContinueWatching />

      {trending.data && trending.data.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Angesagte Anime</h2>
          </div>
          <Rail items={trending.data} />
        </section>
      )}

      {shows.data && shows.data.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Serien</h2>
          </div>
          <Rail items={shows.data} />
        </section>
      )}

      {movies.data && movies.data.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Filme</h2>
          </div>
          <Rail items={movies.data} />
        </section>
      )}
    </>
  );
}
