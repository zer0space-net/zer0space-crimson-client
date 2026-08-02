import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Kind, type MediaCard } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useI18n } from "../lib/i18n";
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
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [term, setTerm] = useState(q);
  // The query can change without this form being touched — the topbar search on
  // a wide screen, or a shared link. Keep the field showing what was searched.
  useEffect(() => setTerm(q), [q]);

  const { data, loading, error } = useAsync(
    (s) => (q ? searchAll(q, s) : Promise.resolve([])),
    [q],
  );

  return (
    <>
      <div className="page-head">
        <h1>{t("search.title")}</h1>
        {q && (
          <p>
            {t("search.resultsFor")} „<strong>{q}</strong>"
          </p>
        )}
      </div>

      {/* The topbar's search box is hidden on a phone, where the bar has room
          for the wordmark and the language switch and nothing else. This is
          where searching happens there — and it works at every width. */}
      <form
        className="search-page"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const next = term.trim();
          if (next) setParams({ q: next });
        }}
      >
        <input
          className="input"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
        />
        <button className="btn btn-primary" type="submit" disabled={!term.trim()}>
          {t("search.submit")}
        </button>
      </form>
      {!q ? (
        <Empty>{t("search.prompt")}</Empty>
      ) : loading ? (
        <Spinner label={t("search.searching")} />
      ) : error ? (
        <ErrorBox error={error} />
      ) : data && data.length ? (
        <PosterGrid items={data} />
      ) : (
        <Empty>
          {t("search.nothing")} „{q}".
        </Empty>
      )}
    </>
  );
}
