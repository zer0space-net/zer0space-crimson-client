import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useI18n } from "../lib/i18n";
import { Spinner, ErrorBox, PosterGrid, Empty } from "../components/ui";

export default function Catalogue() {
  const { t } = useI18n();
  const { data, loading, error } = useAsync((s) => api.catalogue(s), []);
  const [filter, setFilter] = useState("");

  const items = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data;
    return data.filter((m) => m.title.toLowerCase().includes(q));
  }, [data, filter]);

  if (loading) return <Spinner label={t("cat.loading")} />;
  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <div className="page-head">
        <h1>{t("cat.title")}</h1>
        <p>{t("cat.count", { n: data?.length ?? 0 })}</p>
      </div>
      <div style={{ marginBottom: 22, maxWidth: 360 }}>
        <input
          className="input"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("cat.filter")}
          aria-label={t("cat.filter")}
        />
      </div>
      {items.length ? <PosterGrid items={items} /> : <Empty>{t("cat.none")}</Empty>}
    </>
  );
}
