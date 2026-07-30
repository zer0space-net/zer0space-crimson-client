// Locally-remembered watchlist names. The backend has no "empty list" concept —
// a list exists only while it holds at least one title — so a list you just
// created (but haven't added anything to yet) is kept here, per-browser, and
// shown as an empty tab until you drop a title into it. Both the Library page and
// the FavoriteButton menu union these with the lists the backend actually reports.

const LISTS_KEY = "zsc-lists";

export function getLocalLists(): string[] {
  try {
    const raw = localStorage.getItem(LISTS_KEY);
    return raw ? (JSON.parse(raw) as string[]).filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function save(names: string[]): void {
  try {
    localStorage.setItem(LISTS_KEY, JSON.stringify([...new Set(names)]));
  } catch {
    /* ignore */
  }
}

/** Remember a new list name (deduped, trimmed, capped to the backend's 100). */
export function addLocalList(name: string): void {
  const n = name.trim().slice(0, 100);
  if (!n) return;
  const all = getLocalLists();
  if (!all.includes(n)) save([...all, n]);
}

export function removeLocalList(name: string): void {
  save(getLocalLists().filter((n) => n !== name));
}
