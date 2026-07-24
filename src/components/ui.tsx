import { Link } from "react-router-dom";
import type { MediaCard } from "../lib/api";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center-box" role="status">
      <div className="spinner spin" />
      {label && <div className="faint">{label}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: Error }) {
  const unauth = (error as { status?: number }).status === 401;
  return (
    <div className="center-box">
      <div className="badge">{unauth ? "Zugang" : "Fehler"}</div>
      <p className="dim">
        {unauth
          ? "Nicht angemeldet. Crimson ist nur über deine zer0space-Sitzung erreichbar."
          : "Da ist etwas schiefgelaufen. Versuch es gleich noch einmal."}
      </p>
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
  const year = item.year ? String(item.year).slice(0, 4) : null;
  return (
    <Link className="poster" to={titleHref(item)}>
      <div className="poster-img">
        {item.poster ? (
          <img src={item.poster} alt="" loading="lazy" />
        ) : (
          <div className="ph">{item.title}</div>
        )}
        {item.kind === "anime" && (
          <span className="poster-badge badge badge-accent">Anime</span>
        )}
      </div>
      <div className="poster-title" title={item.title}>
        {item.title}
      </div>
      {year && <div className="poster-meta">{year}</div>}
    </Link>
  );
}

function keyOf(m: MediaCard, i: number): string {
  return `${m.kind ?? ""}-${m.tmdb_id ?? m.anilist_id ?? i}`;
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
