import { useSearchParams } from "react-router-dom";
import { api, type MediaSummary } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Spinner, ErrorBox, PosterGrid, Empty } from "../components/ui";

// Searches all three backend indexes in parallel and tags each result with its
// media type so the poster links route to the right overview.
async function searchAll(q: string, signal: AbortSignal): Promise<MediaSummary[]> {
  const kinds: { k: "anime" | "shows" | "movies"; t: MediaSummary["mediaType"] }[] = [
    { k: "anime", t: "anime" },
    { k: "shows", t: "tv" },
    { k: "movies", t: "movie" },
  ];
  const settled = await Promise.allSettled(
    kinds.map(async ({ k, t }) =>
      (await api.search(k, q, signal)).map((m) => ({ ...m, mediaType: m.mediaType ?? t })),
    ),
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
