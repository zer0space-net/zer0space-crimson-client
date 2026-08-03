// The home "Neu & Trending" ticker feed. Assembled from the trending endpoints per
// category and persisted per-browser so it refreshes **once a day** but individual
// items can **linger** for a while after they stop trending (so a fresh drop stays
// visible for a few days, marked NEU). No backend change — it's derived client-side.

import { api, type MediaCard, type Kind } from "./api";

export type NewsCat = "anime" | "series" | "movie";

export interface NewsItem extends MediaCard {
  category: NewsCat;
  firstSeen: number; // ms — when this item first entered the feed
}

const KEY = "zsc-news";
const DAY = 86_400_000;
const LINGER_DAYS = 6; // an item that stops trending stays this long before dropping
const NEW_DAYS = 2; // items first seen within this window get the NEU badge

interface Store {
  day: string; // YYYY-MM-DD the feed was last rebuilt
  items: NewsItem[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function idOf(m: MediaCard): string {
  return `${m.kind ?? ""}:${m.tmdb_id ?? m.anilist_id ?? m.title}`;
}

function load(): Store | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : null;
  } catch {
    return null;
  }
}

function save(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

const CATS: { cat: NewsCat; kind: Kind }[] = [
  { cat: "anime", kind: "anime" },
  { cat: "series", kind: "show" },
  { cat: "movie", kind: "movie" },
];

/** Whether an item counts as freshly added (drives the NEU badge). */
export function isNew(item: NewsItem): boolean {
  return Date.now() - item.firstSeen < NEW_DAYS * DAY;
}

/**
 * Return the news feed. Uses the stored feed unchanged when it was already built
 * today (so it only refreshes once a day); otherwise fetches fresh trending, merges
 * it with the stored feed — new titles get ``firstSeen = now`` (→ NEU), still-trending
 * ones keep their original date, and ones that dropped out linger up to LINGER_DAYS —
 * then persists and returns it. Best-effort: on a fetch failure the stored feed stands.
 */
export async function getNews(signal?: AbortSignal): Promise<NewsItem[]> {
  const stored = load();
  if (stored && stored.day === today() && stored.items.length) {
    return sortFeed(stored.items);
  }

  let fresh: NewsItem[];
  try {
    const lists = await Promise.all(
      CATS.map(({ kind }) => api.trending(kind, signal).catch(() => [] as MediaCard[])),
    );
    const now = Date.now();
    fresh = [];
    lists.forEach((list, i) => {
      const cat = CATS[i].cat;
      for (const m of list.slice(0, 14)) {
        if (!m.poster && !m.backdrop) continue;
        fresh.push({ ...m, category: cat, firstSeen: now });
      }
    });
  } catch {
    return stored ? sortFeed(stored.items) : [];
  }
  if (!fresh.length) return stored ? sortFeed(stored.items) : [];

  // Merge: keep firstSeen for items we've seen before.
  const prev = new Map((stored?.items ?? []).map((it) => [idOf(it), it]));
  const freshIds = new Set(fresh.map(idOf));
  const merged: NewsItem[] = fresh.map((it) => {
    const old = prev.get(idOf(it));
    return old ? { ...it, firstSeen: old.firstSeen } : it;
  });
  // Let items that dropped out of trending linger until they age past LINGER_DAYS.
  const cutoff = Date.now() - LINGER_DAYS * DAY;
  for (const it of stored?.items ?? []) {
    if (!freshIds.has(idOf(it)) && it.firstSeen >= cutoff) merged.push(it);
  }

  save({ day: today(), items: merged });
  return sortFeed(merged);
}

// Newest first, so the NEU drops lead the ticker.
function sortFeed(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => b.firstSeen - a.firstSeen);
}
