import { Link } from "react-router-dom";
import type { MediaCard } from "../lib/api";
import { useI18n } from "../lib/i18n";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center-box" role="status">
      <div className="spinner spin" />
      {label && <div className="faint">{label}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: Error }) {
  const { t } = useI18n();
  const unauth = (error as { status?: number }).status === 401;
  return (
    <div className="center-box">
      <div className="badge">{unauth ? t("err.accessTag") : t("err.errorTag")}</div>
      <p className="dim">{unauth ? t("err.unauth") : t("err.generic")}</p>
      <p className="faint mono" style={{ fontSize: "0.78rem" }}>
        {error.message}
      </p>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

// Route a card to its overview page. Anime is AniList-keyed, show/movie TMDB-keyed
// — mirrors the backend's own keying.
function titleHref(m: MediaCard): string {
  if (m.kind === "anime" && m.anilist_id) return `/title/anime/${m.anilist_id}`;
  if (m.kind === "movie" && m.tmdb_id) return `/title/movie/${m.tmdb_id}`;
  if (m.kind === "show" && m.tmdb_id) return `/title/show/${m.tmdb_id}`;
  if (m.anilist_id) return `/title/anime/${m.anilist_id}`;
  if (m.tmdb_id) return `/title/show/${m.tmdb_id}`;
  return "#";
}

export function Poster({ item }: { item: MediaCard }) {
  const { t } = useI18n();
  const year = item.year ? String(item.year).slice(0, 4) : null;
  const rating =
    item.vote_average && item.vote_average > 0 ? item.vote_average.toFixed(1) : null;
  return (
    <Link className="poster" to={titleHref(item)}>
      <div className="poster-img">
        {item.poster ? (
          <img src={item.poster} alt="" loading="lazy" />
        ) : (
          <div className="ph">{item.title}</div>
        )}
        {item.kind === "anime" && (
          <span className="poster-badge badge badge-accent">{t("common.anime")}</span>
        )}
        {/* Netflix-style hover peek: reveals a play affordance + quick facts. */}
        <div className="poster-hover" aria-hidden="true">
          <span className="poster-hover-play">▶</span>
          <div className="poster-hover-info">
            <span className="poster-hover-title">{item.title}</span>
            <span className="poster-hover-meta">
              {year && <span>{year}</span>}
              {rating && <span className="poster-hover-rate">★ {rating}</span>}
            </span>
          </div>
        </div>
      </div>
      <div className="poster-title" title={item.title}>
        {item.title}
      </div>
      {year && <div className="poster-meta">{year}</div>}
    </Link>
  );
}

function keyOf(m: MediaCard, i: number): string {
  // Always append the index so keys are unique even when the same title appears
  // more than once in a grid (e.g. a watchlist title that lives in two lists, or
  // the same show surfacing in two rails). Duplicate keys break React's
  // reconciliation — the grid renders a stale set and stops updating on filter.
  return `${m.kind ?? ""}-${m.tmdb_id ?? m.anilist_id ?? "x"}-${i}`;
}

export function PosterGrid({ items }: { items: MediaCard[] }) {
  return (
    <div className="poster-grid">
      {items.map((m, i) => (
        <Poster key={keyOf(m, i)} item={m} />
      ))}
    </div>
  );
}

export function Rail({ items }: { items: MediaCard[] }) {
  return (
    <div className="rail">
      {items.map((m, i) => (
        <Poster key={keyOf(m, i)} item={m} />
      ))}
    </div>
  );
}
