import { useEffect, useState } from "react";
import { api, type Kind } from "../lib/api";
import { useAccount } from "../lib/useAccount";

interface Props {
  kind: Kind;
  tmdbId?: number | null;
  anilistId?: number | null;
  title?: string | null;
  poster?: string | null;
  season?: number | null;
}

// The backend namespaces a favourite's item_key by kind (anilist: / tmdb: /
// movie:) — mirror that so membership checks and removals target the same row.
function expectedKey(kind: Kind, tmdbId?: number | null, anilistId?: number | null): string | null {
  if (kind === "anime" && anilistId != null) return `anilist:${anilistId}`;
  if (kind === "movie" && tmdbId != null) return `movie:${tmdbId}`;
  if (tmdbId != null) return `tmdb:${tmdbId}`;
  if (anilistId != null) return `anilist:${anilistId}`;
  return null;
}

export default function FavoriteButton(props: Props) {
  const { kind, tmdbId, anilistId, title, poster, season } = props;
  const available = useAccount();
  const [fav, setFav] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const key = expectedKey(kind, tmdbId, anilistId);

  useEffect(() => {
    if (available !== true || !key) return;
    let live = true;
    api
      .favorites()
      .then((list) => {
        if (live) setFav(list.some((f) => f.item_key === key));
      })
      .catch(() => {
        if (live) setFav(false);
      });
    return () => {
      live = false;
    };
  }, [available, key]);

  if (available !== true || !key) return null;

  const identity =
    kind === "movie"
      ? { tmdb_id: tmdbId ?? undefined, media_type: "movie" }
      : kind === "anime"
        ? { anilist_id: anilistId ?? undefined, tmdb_id: tmdbId ?? undefined }
        : { tmdb_id: tmdbId ?? undefined };

  async function toggle() {
    if (busy || fav === null) return;
    setBusy(true);
    const next = !fav;
    setFav(next); // optimistic
    try {
      if (next) {
        await api.addFavorite({
          tmdb_id: tmdbId ?? undefined,
          anilist_id: anilistId ?? undefined,
          media_type: kind === "movie" ? "movie" : undefined,
          season_number: season ?? undefined,
          title: title ?? undefined,
          poster: poster ?? undefined,
        });
      } else {
        await api.removeFavorite(identity);
      }
    } catch {
      setFav(!next); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={"btn btn-sm " + (fav ? "btn-primary" : "btn-ghost")}
      onClick={toggle}
      aria-pressed={fav ?? false}
      disabled={busy || fav === null}
    >
      {fav ? "★ Gemerkt" : "☆ Merken"}
    </button>
  );
}
