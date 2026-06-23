// Bookmarks: a simple, most-recent-first list persisted to localStorage.

export interface Bookmark {
  url: string;
  title: string;
}

const KEY = "tauri-browser.bookmarks";

export function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d)) return d;
    }
  } catch {
    /* ignore corrupt state */
  }
  return [];
}

function save(list: Bookmark[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore quota / availability errors */
  }
}

export function isBookmarked(url: string, list: Bookmark[]): boolean {
  return list.some((b) => b.url === url);
}

/** Add the page if it isn't bookmarked, otherwise remove it. Returns the new list. */
export function toggleBookmark(url: string, title: string): Bookmark[] {
  const list = loadBookmarks();
  const idx = list.findIndex((b) => b.url === url);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift({ url, title });
  save(list);
  return list;
}

export function removeBookmark(url: string): Bookmark[] {
  const list = loadBookmarks().filter((b) => b.url !== url);
  save(list);
  return list;
}

export function clearBookmarks(): Bookmark[] {
  save([]);
  return [];
}
