// Browsing history: a capped, most-recent-first list persisted to localStorage.

export interface HistoryEntry {
  url: string;
  title: string;
  ts: number;
}

const KEY = "tauri-browser.history";
const MAX = 500;

export function loadHistory(): HistoryEntry[] {
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

function save(list: HistoryEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore quota / availability errors */
  }
}

/** Record a visit. Skips internal/blank urls and collapses immediate reloads of
 *  the same page into a single (most recent) entry. */
export function pushHistory(url: string, title: string): HistoryEntry[] {
  const list = loadHistory();
  if (!url || url === "about:blank" || url.startsWith("https://newtab.local")) return list;
  if (list[0]?.url === url) {
    list[0] = { url, title: title || list[0].title, ts: Date.now() };
  } else {
    list.unshift({ url, title, ts: Date.now() });
  }
  const trimmed = list.slice(0, MAX);
  save(trimmed);
  return trimmed;
}

export function clearHistory(): HistoryEntry[] {
  save([]);
  return [];
}
