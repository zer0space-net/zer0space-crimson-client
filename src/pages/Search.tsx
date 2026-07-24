import { useSearchParams } from "react-router-dom";
import { api, type Kind, type MediaCard } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Spinner, ErrorBox, PosterGrid, Empty } from "../components/ui";

// Searches all three backend indexes in parallel; api.search tags each result
// with its kind so the poster links route to the right overview.
async function searchAll(term: string, signal: AbortSignal): Promise<MediaCard[]> {
  const kinds: Kind[] = ["anime", "show", "movie"];
  const settled = await Promise.allSettled(
    kinds.map((k) => api.search(k, term, signal)),
  );
  return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const { data, loading, error } = useAsync(
    (s) => (q ? searchAll(q, s) : Promise.resolve([])),
    [q],
  );

  return (
    <>
      <div className="page-head">
        <h1>Suche</h1>
        {q && (
          <p>
            Ergebnisse für „<strong>{q}</strong>"
          </p>
        )}
      </div>
      {!q ? (
        <Empty>Tippe oben einen Titel ein.</Empty>
      ) : loading ? (
        <Spinner label="Suche …" />
      ) : error ? (
        <ErrorBox error={error} />
      ) : data && data.length ? (
        <PosterGrid items={data} />
      ) : (
        <Empty>Nichts gefunden für „{q}".</Empty>
      )}
    </>
  );
}
