import { useMemo, useRef, useState } from "react";
import { api, type Favorite, type Kind, type MediaCard } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useAccount } from "../lib/useAccount";
import { useI18n } from "../lib/i18n";
import { Spinner, ErrorBox, PosterGrid, Empty } from "../components/ui";

const DEFAULT_LIST = "favorites";

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
  const fileRef = useRef<HTMLInputElement>(null);

  // Distinct lists with their item counts, in first-seen order.
  const lists = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of data ?? []) {
      const n = f.list_name || DEFAULT_LIST;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }, [data]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? [])
      .filter((f) => !list || (f.list_name || DEFAULT_LIST) === list)
      .filter((f) => !q || (f.title || "").toLowerCase().includes(q))
      .map(toCard);
  }, [data, list, query]);

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
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

        {/* Export / import toolbar */}
        <div className="row gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <a className="btn btn-sm btn-ghost" href={api.exportHref("csv")} download>
            {t("lib.exportCsv")}
          </a>
          <a className="btn btn-sm btn-ghost" href={api.exportHref("json")} download>
            {t("lib.exportJson")}
          </a>
          <div className="seg" role="group" aria-label={t("lib.import")}>
            <button type="button" aria-pressed={mode === "merge"} onClick={() => setMode("merge")}>
              {t("lib.importMerge")}
            </button>
            <button type="button" aria-pressed={mode === "replace"} onClick={() => setMode("replace")}>
              {t("lib.importReplace")}
            </button>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
            {t("lib.import")}
          </button>
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

      {/* Search */}
      <input
        className="input"
        placeholder={t("lib.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ maxWidth: 420, marginBottom: 16 }}
      />

      {/* List tabs (with counts) */}
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
        <Empty>{hasAny && query ? t("lib.noMatch") : t("lib.empty")}</Empty>
      )}
    </>
  );
}
