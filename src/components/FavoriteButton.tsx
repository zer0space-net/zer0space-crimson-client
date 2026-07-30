import { useEffect, useRef, useState } from "react";
import { api, type Kind } from "../lib/api";
import { useAccount } from "../lib/useAccount";
import { useI18n } from "../lib/i18n";

interface Props {
  kind: Kind;
  tmdbId?: number | null;
  anilistId?: number | null;
  title?: string | null;
  poster?: string | null;
  season?: number | null;
}

const DEFAULT_LIST = "favorites";

// The backend namespaces a favourite's item_key by kind (anilist: / tmdb: /
// movie:) — mirror that so membership checks and removals target the same row.
function expectedKey(kind: Kind, tmdbId?: number | null, anilistId?: number | null): string | null {
  if (kind === "anime" && anilistId != null) return `anilist:${anilistId}`;
  if (kind === "movie" && tmdbId != null) return `movie:${tmdbId}`;
  if (tmdbId != null) return `tmdb:${tmdbId}`;
  if (anilistId != null) return `anilist:${anilistId}`;
  return null;
}

// Save/unsave a title, and manage which named watchlists it belongs to. The main
// button quick-toggles the default list; the caret opens a menu to add/remove the
// title from any list (a title can live in several at once) or start a new one.
export default function FavoriteButton(props: Props) {
  const { kind, tmdbId, anilistId, title, poster, season } = props;
  const { t } = useI18n();
  const available = useAccount();
  const [member, setMember] = useState<Set<string> | null>(null); // lists holding this title
  const [allLists, setAllLists] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const key = expectedKey(kind, tmdbId, anilistId);

  useEffect(() => {
    if (available !== true || !key) return;
    let live = true;
    api
      .favorites()
      .then((list) => {
        if (!live) return;
        setMember(new Set(list.filter((f) => f.item_key === key).map((f) => f.list_name || DEFAULT_LIST)));
        const names: string[] = [];
        for (const f of list) {
          const n = f.list_name || DEFAULT_LIST;
          if (!names.includes(n)) names.push(n);
        }
        if (!names.includes(DEFAULT_LIST)) names.unshift(DEFAULT_LIST);
        setAllLists(names);
      })
      .catch(() => {
        if (live) setMember(new Set());
      });
    return () => {
      live = false;
    };
  }, [available, key]);

  // Close the menu on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (available !== true || !key) return null;

  const identity =
    kind === "movie"
      ? { tmdb_id: tmdbId ?? undefined, media_type: "movie" }
      : kind === "anime"
        ? { anilist_id: anilistId ?? undefined, tmdb_id: tmdbId ?? undefined }
        : { tmdb_id: tmdbId ?? undefined };

  const inAny = (member?.size ?? 0) > 0;

  async function setInList(list: string, want: boolean) {
    if (busy || member === null) return;
    setBusy(true);
    const next = new Set(member);
    if (want) next.add(list);
    else next.delete(list);
    setMember(next); // optimistic
    if (want && !allLists.includes(list)) setAllLists([...allLists, list]);
    try {
      if (want) {
        await api.addFavorite({
          tmdb_id: tmdbId ?? undefined,
          anilist_id: anilistId ?? undefined,
          media_type: kind === "movie" ? "movie" : undefined,
          season_number: season ?? undefined,
          title: title ?? undefined,
          poster: poster ?? undefined,
          list_name: list,
        });
      } else {
        await api.removeFavorite({ ...identity, list_name: list });
      }
    } catch {
      setMember(member); // revert
    } finally {
      setBusy(false);
    }
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim().slice(0, 100);
    if (!name) return;
    setNewName("");
    await setInList(name, true);
  }

  return (
    <div className="fav-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"btn btn-sm " + (inAny ? "btn-primary" : "btn-ghost")}
        onClick={() => setInList(DEFAULT_LIST, !member?.has(DEFAULT_LIST))}
        aria-pressed={inAny}
        disabled={busy || member === null}
      >
        {inAny ? t("fav.saved") : t("fav.save")}
      </button>
      <button
        type="button"
        className={"btn btn-sm btn-ghost fav-caret"}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("lib.newList")}
        disabled={member === null}
      >
        ▾
      </button>

      {open && (
        <div className="fav-menu glass" role="menu">
          {allLists.map((n) => (
            <button
              key={n}
              type="button"
              className={"fav-menu-row" + (member?.has(n) ? " is-on" : "")}
              onClick={() => setInList(n, !member?.has(n))}
              disabled={busy}
            >
              <span className="fav-check">{member?.has(n) ? "✓" : ""}</span>
              <span>{n === DEFAULT_LIST ? t("nav.library") : n}</span>
            </button>
          ))}
          <form className="fav-new" onSubmit={createAndAdd}>
            <input
              className="input input-sm"
              placeholder={t("lib.newListPrompt")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
            />
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !newName.trim()}>
              +
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
