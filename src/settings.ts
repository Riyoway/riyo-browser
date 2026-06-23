// User-facing browser settings + localStorage persistence, plus the address-bar
// "is this a URL or a search query?" logic that depends on the chosen engine.

export type SearchEngine = "google" | "bing" | "duckduckgo";
export type Theme = "dark" | "light";

export interface Settings {
  homepage: string;
  searchEngine: SearchEngine;
  openNewTabToHomepage: boolean;
  theme: Theme;
}

const KEY = "tauri-browser.settings";

export const DEFAULT_HOMEPAGE = "https://www.google.com/";

export const DEFAULT_SETTINGS: Settings = {
  homepage: DEFAULT_HOMEPAGE,
  searchEngine: "google",
  openNewTabToHomepage: true,
  theme: "dark",
};

const SEARCH_URLS: Record<SearchEngine, string> = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
};

export const SEARCH_ENGINE_LABEL: Record<SearchEngine, string> = {
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore corrupt state */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): Settings {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / availability errors */
  }
  return s;
}

export function searchUrl(query: string, engine: SearchEngine): string {
  return SEARCH_URLS[engine] + encodeURIComponent(query);
}

/** Turn raw address-bar text into a navigable URL: keep explicit schemes, treat
 *  host-looking input as https, and send everything else to the search engine. */
export function toUrl(raw: string, engine: SearchEngine): string | null {
  const u = raw.trim();
  if (!u) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u; // http://, https://, file://, ...
  if (/^(about:|data:|blob:|view-source:)/i.test(u)) return u;
  const looksLikeHost =
    !u.includes(" ") &&
    (/^[^\s/]+\.[^\s/]{2,}(\/.*)?$/.test(u) || /^localhost(:\d+)?(\/.*)?$/i.test(u));
  if (looksLikeHost) return "https://" + u;
  return searchUrl(u, engine);
}
