// Tab model + localStorage persistence. The tab list (urls) survives close/restart;
// live page state does not (the webviews are recreated from these urls).

export interface Tab {
  id: string;
  url: string;
  title: string;
}

export interface TabState {
  tabs: Tab[];
  activeId: string;
}

import { getCurrentWindow } from "@tauri-apps/api/window";

// Internal URL for the New Tab / blank page. Tabs with this url have no native
// webview; the React `NewTabPage` overlay is shown instead (see App.tsx).
export const NEWTAB = "about:newtab";

// Tabs are per-window. The main window keeps the original key (backward compat);
// each secondary window gets its own namespaced key so its tab list is separate.
const WIN_LABEL = (() => {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
})();
const KEY = WIN_LABEL === "main" ? "tauri-browser.tabs" : `tauri-browser.tabs.${WIN_LABEL}`;

export const newId = () => "t" + Math.random().toString(36).slice(2, 10);

export function titleOf(url: string): string {
  try {
    if (!url || url === "about:blank" || url === NEWTAB) return "New tab";
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

export function loadTabs(): TabState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d?.tabs) && d.tabs.length) {
        const tabs: Tab[] = d.tabs.map((t: Partial<Tab>) => ({
          id: t.id || newId(),
          url: t.url || NEWTAB,
          title: t.title || titleOf(t.url || NEWTAB),
        }));
        const activeId = tabs.some((t) => t.id === d.activeId) ? d.activeId : tabs[0].id;
        return { tabs, activeId };
      }
    }
  } catch {
    /* ignore corrupt state */
  }
  const id = newId();
  return { tabs: [{ id, url: NEWTAB, title: "New tab" }], activeId: id };
}

export function persistTabs(state: TabState): TabState {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / availability errors */
  }
  return state;
}
