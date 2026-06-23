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
  setAlwaysOnTop: (v: boolean) => appWindow.setAlwaysOnTop(v),
  /** Open a fresh browser window with its own tabs (optionally on `url`). */
  newWindow: (url?: string) => invoke<void>("new_window", { url: url ?? null }),
  /** This window's pending "open this url on startup" (consumed once). */
  takePendingOpen: () => invoke<string | null>("take_pending_open"),
};

export const api = {
  /** Show tab `id` at the given (logical px) bounds; returns true if it was freshly
   *  created — the caller then navigates it to the tab's url. */
  tabShow: (id: string, x: number, y: number, width: number, height: number) =>
    invoke<boolean>("browser_tab_show", { id, x, y, width, height }),
  tabNavigate: (id: string, url: string) => invoke<void>("browser_tab_navigate", { id, url }),
  tabClose: (id: string) => invoke<void>("browser_tab_close", { id }),
  tabEval: (id: string, action: TabAction) => invoke<void>("browser_tab_eval", { id, action }),
  /** Drive a tab's active media element (toolbar player / PiP). */
  tabMedia: (id: string, action: "playpause" | "pip") => invoke<void>("browser_tab_media", { id, action }),
  hideAll: () => invoke<void>("browser_hide_all"),
  /** Backend HTTPS GET (bypasses webview CORS) — used by the New Tab page for RSS. */
  httpGetText: (url: string) => invoke<string>("http_get_text", { url }),
  /** Push the website permission defaults (kind id → "ask"|"allow"|"block"). */
  setPermissions: (perms: Record<string, string>) => invoke<void>("set_permissions", { perms }),
};

// ---- downloads (queue-managed; see src-tauri/src/downloads.rs) ----
export type DownloadStatus = "queued" | "active" | "paused" | "completed" | "failed" | "canceled";
export interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  path: string;
  status: DownloadStatus;
  received: number;
  total: number;
  error: string;
  createdAt: number;
}

export const downloads = {
  list: () => invoke<DownloadItem[]>("download_list"),
  enqueue: (url: string, filename?: string) =>
    invoke<string>("download_enqueue", { url, filename: filename ?? null }),
  maxConcurrent: () => invoke<number>("download_max_concurrent"),
  setMaxConcurrent: (n: number) => invoke<void>("download_set_max_concurrent", { n }),
  pause: (id: string) => invoke<void>("download_pause", { id }),
  resume: (id: string) => invoke<void>("download_resume", { id }),
  retry: (id: string) => invoke<void>("download_retry", { id }),
  cancel: (id: string) => invoke<void>("download_cancel", { id }),
  remove: (id: string) => invoke<void>("download_remove", { id }),
  clearFinished: () => invoke<void>("download_clear_finished"),
  open: (id: string) => invoke<void>("download_open", { id }),
  openFolder: (id: string) => invoke<void>("download_open_folder", { id }),
};

export const downloadEvents = {
  /** Full list snapshot whenever an item is added / changes status. */
  onChanged: (cb: (items: DownloadItem[]) => void): Promise<UnlistenFn> =>
    listen<DownloadItem[]>("downloads-changed", (e) => cb(e.payload)),
  /** Frequent byte-progress for the active downloads. */
  onProgress: (
    cb: (p: { id: string; received: number; total: number }) => void
  ): Promise<UnlistenFn> =>
    listen<{ id: string; received: number; total: number }>("downloads-progress", (e) => cb(e.payload)),
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
  /** A browser command forwarded from a tab page (keyboard shortcut or context
   *  menu action); `arg` carries e.g. the search query. */
  onShortcut: (cb: (s: { id: string; cmd: string; arg: string }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; cmd: string; arg: string }>("browser-shortcut", (e) => cb(e.payload)),
};
