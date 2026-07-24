import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Spinner, ErrorBox, Rail } from "../components/ui";

export default function Home() {
  const trending = useAsync((s) => api.trending("", s), []);
  const shows = useAsync((s) => api.trending("shows", s), []);
  const movies = useAsync((s) => api.trending("movies", s), []);

  if (trending.loading && shows.loading && movies.loading) return <Spinner label="Lade …" />;
  if (trending.error && shows.error && movies.error) return <ErrorBox error={trending.error} />;

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">zer0space ✕ Crimson</span>
        <h1>Was läuft gerade</h1>
        <p>Angetrieben vom Crimson-Haven-Backend, im zer0space-Universum.</p>
      </div>

      {trending.data && trending.data.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Angesagt</h2>
          </div>
          <Rail items={trending.data} />
        </section>
      )}

      {shows.data && shows.data.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Serien</h2>
          </div>
          <Rail items={shows.data} />
        </section>
      )}

      {movies.data && movies.data.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Filme</h2>
          </div>
          <Rail items={movies.data} />
        </section>
      )}
    </>
  );
}
