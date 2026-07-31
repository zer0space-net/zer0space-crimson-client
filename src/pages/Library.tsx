import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Favorite, type Kind, type MediaCard } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useAccount } from "../lib/useAccount";
import { useI18n } from "../lib/i18n";
import { getLocalLists, addLocalList } from "../lib/lists";
import { Spinner, ErrorBox, PosterGrid, Empty } from "../components/ui";

const DEFAULT_LIST = "favorites";
type Menu = "export" | "import" | "newlist" | null;

// A saved favourite → a routable card. kind mirrors the backend's item-key
// namespacing (movie / anilist=anime / else show).
function toCard(f: Favorite): MediaCard {
  const kind: Kind = f.media_type === "movie" ? "movie" : f.anilist_id ? "anime" : "show";
  return {
    title: f.title || "—",
    tmdb_id: f.tmdb_id ?? null,
    anilist_id: f.anilist_id ?? null,
    poster: f.poster ?? null,
    kind,
  };
}

export default function Library() {
  const { t } = useI18n();
  const available = useAccount();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading, error } = useAsync(
    (s) => (available === true ? api.favorites(s) : Promise.resolve([])),
    [available, reloadKey],
  );

  const [list, setList] = useState<string>(""); // "" = all lists
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [note, setNote] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [newName, setNewName] = useState("");
  const [localLists, setLocalLists] = useState<string[]>(getLocalLists);
  const fileRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Close any open toolbar menu on an outside click.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  // Lists with counts: every list the backend reports, plus any empty list the
  // user created locally (count 0) so it still shows as a tab.
  const lists = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of localLists) counts.set(n, 0);
    for (const f of data ?? []) {
      const n = f.list_name || DEFAULT_LIST;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }, [data, localLists]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const out: MediaCard[] = [];
    for (const f of data ?? []) {
      if (list && (f.list_name || DEFAULT_LIST) !== list) continue;
      if (q && !(f.title || "").toLowerCase().includes(q)) continue;
      const card = toCard(f);
      // Dedupe: the same title can live in several lists, so the "all" view would
      // otherwise show it once per list.
      const id = `${card.kind}:${card.tmdb_id ?? card.anilist_id ?? card.title}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(card);
    }
    return out;
  }, [data, list, query]);

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setMenu(null);
    if (!file) return;
    setNote(null);
    try {
      const text = await file.text();
      const r = await api.importFavorites(text, mode);
      setNote(t("lib.imported", { n: r.imported ?? 0 }));
      setReloadKey((k) => k + 1);
    } catch {
      setNote(t("lib.importFail"));
    }
  }

  function createList(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim().slice(0, 100);
    if (!name) return;
    addLocalList(name);
    setLocalLists(getLocalLists());
    setNewName("");
    setMenu(null);
    setList(name);
  }

  if (available !== true)
    return (
      <>
        <div className="page-head">
          <h1>{t("lib.title")}</h1>
        </div>
        <Empty>{t("err.unauth")}</Empty>
      </>
    );
  if (loading) return <Spinner label={t("common.loading")} />;
  if (error) return <ErrorBox error={error} />;

  const hasAny = (data ?? []).length > 0;

  return (
    <>
      <div className="page-head row gap-14" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ marginRight: "auto" }}>{t("lib.title")}</h1>

        {/* Compact toolbar: New list · Export ▾ · Import ▾ */}
        <div className="row gap-8" ref={barRef} style={{ position: "relative" }}>
          <div className="menu-wrap">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setMenu(menu === "newlist" ? null : "newlist")}
              aria-expanded={menu === "newlist"}
            >
              + {t("lib.newList")}
            </button>
            {menu === "newlist" && (
              <form className="pop glass" onSubmit={createList}>
                <input
                  className="input input-sm"
                  placeholder={t("lib.newListPrompt")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={100}
                  autoFocus
                />
                <button type="submit" className="btn btn-sm btn-primary" disabled={!newName.trim()}>
                  {t("lib.create")}
                </button>
              </form>
            )}
          </div>

          <div className="menu-wrap">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setMenu(menu === "export" ? null : "export")}
              aria-expanded={menu === "export"}
            >
              {t("lib.export")} ▾
            </button>
            {menu === "export" && (
              <div className="pop glass pop-col">
                <a className="pop-row" href={api.exportHref("csv")} download onClick={() => setMenu(null)}>
                  {t("lib.exportCsv")}
                </a>
                <a className="pop-row" href={api.exportHref("json")} download onClick={() => setMenu(null)}>
                  {t("lib.exportJson")}
                </a>
              </div>
            )}
          </div>

          <div className="menu-wrap">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setMenu(menu === "import" ? null : "import")}
              aria-expanded={menu === "import"}
            >
              {t("lib.import")} ▾
            </button>
            {menu === "import" && (
              <div className="pop glass pop-col" style={{ minWidth: 220 }}>
                <div className="seg" role="group" aria-label={t("lib.import")} style={{ margin: "2px 0 8px" }}>
                  <button type="button" aria-pressed={mode === "merge"} onClick={() => setMode("merge")}>
                    {t("lib.importMerge")}
                  </button>
                  <button type="button" aria-pressed={mode === "replace"} onClick={() => setMode("replace")}>
                    {t("lib.importReplace")}
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => fileRef.current?.click()}
                >
                  {t("lib.chooseFile")}
                </button>
                <p className="faint" style={{ fontSize: "0.72rem", marginTop: 6 }}>
                  {mode === "replace" ? t("lib.replaceHint") : t("lib.mergeHint")}
                </p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            hidden
            onChange={onImportFile}
          />
        </div>
      </div>

      {note && (
        <p className="faint" style={{ marginBottom: 14, fontSize: "0.84rem" }}>
          {note}
        </p>
      )}

      <input
        className="input"
        placeholder={t("lib.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ maxWidth: 420, marginBottom: 16 }}
      />

      {lists.length > 1 && (
        <div className="season-tabs" style={{ marginBottom: 18 }}>
          <button
            type="button"
            className={"btn btn-sm " + (list === "" ? "btn-primary" : "btn-ghost")}
            onClick={() => setList("")}
          >
            {t("lib.all")} ({(data ?? []).length})
          </button>
          {lists.map((l) => (
            <button
              key={l.name}
              type="button"
              className={"btn btn-sm " + (list === l.name ? "btn-primary" : "btn-ghost")}
              onClick={() => setList(l.name)}
            >
              {l.name === DEFAULT_LIST ? t("lib.title") : l.name} ({l.count})
            </button>
          ))}
        </div>
      )}

      {items.length ? (
        <PosterGrid items={items} />
      ) : (
        <Empty>{hasAny && (query || list) ? t("lib.noMatch") : t("lib.empty")}</Empty>
      )}
    </>
  );
}
