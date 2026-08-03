import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getNews, isNew, type NewsItem, type NewsCat } from "../lib/news";
import { useAsync } from "../lib/useAsync";
import { useI18n } from "../lib/i18n";

// Route a news card to its title page (same id namespacing as the poster grid:
// anime → anilist id, everything else → tmdb id).
function titleHref(m: NewsItem): string {
  if (m.kind === "anime" && m.anilist_id) return `/title/anime/${m.anilist_id}`;
  if (m.kind === "movie" && m.tmdb_id) return `/title/movie/${m.tmdb_id}`;
  if (m.tmdb_id) return `/title/show/${m.tmdb_id}`;
  if (m.anilist_id) return `/title/anime/${m.anilist_id}`;
  return "#";
}

const CAT_KEY: Record<NewsCat, string> = {
  anime: "news.anime",
  series: "news.series",
  movie: "news.movies",
};

function NewsCard({ item }: { item: NewsItem }) {
  const { t } = useI18n();
  const img = item.backdrop || item.poster || "";
  const rating =
    item.vote_average && item.vote_average > 0 ? item.vote_average.toFixed(1) : null;
  return (
    <Link className="news-card" to={titleHref(item)} title={item.title}>
      <div className="news-card-img">
        {img ? <img src={img} alt="" loading="lazy" /> : <div className="news-card-ph" />}
        <span className="news-card-shade" aria-hidden="true" />
      </div>
      <div className="news-card-body">
        <div className="news-card-tags">
          <span className={`news-cat news-cat-${item.category}`}>{t(CAT_KEY[item.category])}</span>
          {isNew(item) && <span className="news-badge">{t("news.new")}</span>}
        </div>
        <div className="news-card-title">{item.title}</div>
        <div className="news-card-meta">
          {item.year ? <span>{item.year}</span> : null}
          {rating ? <span className="news-rate">★ {rating}</span> : null}
        </div>
      </div>
    </Link>
  );
}

export default function NewsTicker() {
  const { t } = useI18n();
  const { data } = useAsync((s) => getNews(s), []);
  const [cat, setCat] = useState<"all" | NewsCat>("all");

  const items = useMemo(
    () => (!data ? [] : cat === "all" ? data : data.filter((i) => i.category === cat)),
    [data, cat],
  );

  if (!data || data.length === 0 || items.length === 0) return null;

  // Duplicate the run so the marquee loops seamlessly (the track translates by
  // exactly -50%). Speed scales with the item count so density stays comfortable.
  const loop = [...items, ...items];
  const duration = Math.max(24, items.length * 4.5);

  const tabs: ("all" | NewsCat)[] = ["all", "anime", "series", "movie"];
  const tabKey: Record<string, string> = {
    all: "news.all",
    anime: "news.anime",
    series: "news.series",
    movie: "news.movies",
  };

  return (
    <section className="news">
      <div className="news-head">
        <h2>{t("news.title")}</h2>
        <div className="news-cats" role="group" aria-label={t("news.title")}>
          {tabs.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cat === c}
              onClick={() => setCat(c)}
            >
              {t(tabKey[c])}
            </button>
          ))}
        </div>
      </div>

      <div className="news-viewport">
        <div className="news-track" style={{ animationDuration: `${duration}s` }} key={cat}>
          {loop.map((it, i) => (
            <NewsCard key={i} item={it} />
          ))}
        </div>
      </div>
    </section>
  );
}
