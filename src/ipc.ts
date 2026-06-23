import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type TabAction = "back" | "forward" | "reload";

// ---- custom title-bar window controls ----
// The native decorations are disabled (see tauri.conf.json), so the tab strip
// acts as the title bar and drives these directly.
const appWindow = getCurrentWindow();
export const win = {
  minimize: () => appWindow.minimize(),
  toggleMaximize: () => appWindow.toggleMaximize(),
  // Routes through the CloseRequested handler, which hides to the tray.
  close: () => appWindow.close(),
};

export const api = {
  /** Show tab `id` at the given (logical px) bounds; returns true if it was freshly
   *  created — the caller then navigates it to the tab's url. */
  tabShow: (id: string, x: number, y: number, width: number, height: number) =>
    invoke<boolean>("browser_tab_show", { id, x, y, width, height }),
  tabNavigate: (id: string, url: string) => invoke<void>("browser_tab_navigate", { id, url }),
  tabClose: (id: string) => invoke<void>("browser_tab_close", { id }),
  tabEval: (id: string, action: TabAction) => invoke<void>("browser_tab_eval", { id, action }),
  hideAll: () => invoke<void>("browser_hide_all"),
  /** Backend HTTPS GET (bypasses webview CORS) — used by the New Tab page for RSS. */
  httpGetText: (url: string) => invoke<string>("http_get_text", { url }),
};

export const events = {
  /** A tab navigated (also fires for in-page redirects). */
  onNav: (cb: (e: { id: string; url: string }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; url: string }>("browser-nav", (e) => cb(e.payload)),
  /** Ctrl/middle-click on a link asked to open a url in a new tab. */
  onNewTab: (cb: (url: string) => void): Promise<UnlistenFn> =>
    listen<string>("browser-new-tab", (e) => cb(e.payload)),
  /** The window was restored from the tray; recreate the torn-down active tab. */
  onMainShown: (cb: () => void): Promise<UnlistenFn> =>
    listen<null>("main-shown", () => cb()),
};
