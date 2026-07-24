import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Spinner, ErrorBox, PosterGrid, Empty } from "../components/ui";

export default function Catalogue() {
  const { data, loading, error } = useAsync((s) => api.catalogue(s), []);
  const [filter, setFilter] = useState("");

  const items = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data;
    return data.filter((m) => m.title.toLowerCase().includes(q));
  }, [data, filter]);

  if (loading) return <Spinner label="Lade Katalog …" />;
  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <div className="page-head">
        <h1>Katalog</h1>
        <p>{data?.length ?? 0} Titel im lokalen Index.</p>
      </div>
      <div style={{ marginBottom: 22, maxWidth: 360 }}>
        <input
          className="input"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Im Katalog filtern …"
          aria-label="Katalog filtern"
        />
      </div>
      {items.length ? <PosterGrid items={items} /> : <Empty>Keine Treffer.</Empty>}
    </>
  );
}
