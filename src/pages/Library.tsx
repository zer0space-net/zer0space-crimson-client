import { useMemo, useState } from "react";
import { api, type Favorite, type Kind, type MediaCard } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useAccount } from "../lib/useAccount";
import { useI18n } from "../lib/i18n";
import { Spinner, ErrorBox, PosterGrid, Empty } from "../components/ui";

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
  const { data, loading, error } = useAsync(
    (s) => (available === true ? api.favorites(s) : Promise.resolve([])),
    [available],
  );
  const [list, setList] = useState<string>("");

  // Distinct list names, in first-seen order.
  const lists = useMemo(() => {
    const seen: string[] = [];
    for (const f of data ?? []) {
      const n = f.list_name || "favorites";
      if (!seen.includes(n)) seen.push(n);
    }
    return seen;
  }, [data]);

  const items = useMemo(
    () => (data ?? []).filter((f) => !list || (f.list_name || "favorites") === list).map(toCard),
    [data, list],
  );

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

  return (
    <>
      <div className="page-head">
        <h1>{t("lib.title")}</h1>
      </div>

      {lists.length > 1 && (
        <div className="season-tabs" style={{ marginBottom: 18 }}>
          <button
            type="button"
            className={"btn btn-sm " + (list === "" ? "btn-primary" : "btn-ghost")}
            onClick={() => setList("")}
          >
            {t("lib.all")}
          </button>
          {lists.map((n) => (
            <button
              key={n}
              type="button"
              className={"btn btn-sm " + (list === n ? "btn-primary" : "btn-ghost")}
              onClick={() => setList(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {items.length ? <PosterGrid items={items} /> : <Empty>{t("lib.empty")}</Empty>}
    </>
  );
}
