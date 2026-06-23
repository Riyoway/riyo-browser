import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge, Button, Input } from "@heroui/react";
import {
  ArrowRight,
  Bookmark as BookmarkIcon,
  ChevronLeft,
  ChevronRight,
  Download,
  EllipsisVertical,
  History as HistoryIcon,
  Home,
  Minus,
  PictureInPicture2,
  Pin,
  Plus,
  RotateCw,
  Search,
  Square,
  SquareArrowOutUpRight,
  Star,
  X,
} from "lucide-react";
import {
  api,
  downloadEvents,
  downloads,
  events,
  win,
  type DownloadItem,
  type TabAction,
} from "./ipc";
import { loadTabs, NEWTAB, newId, persistTabs, titleOf, type Tab, type TabState } from "./tabs";
import { NewTabPage } from "./NewTabPage";
import { loadSettings, saveSettings, SITE_PERMISSIONS, toUrl, type Settings } from "./settings";
import { clearHistory, loadHistory, pushHistory, removeHistoryKeys, type HistoryEntry } from "./history";
import {
  clearBookmarks,
  isBookmarked,
  loadBookmarks,
  removeBookmark,
  toggleBookmark,
  type Bookmark,
} from "./bookmarks";
import { SettingsPanel } from "./SettingsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { BookmarksPanel } from "./BookmarksPanel";
import { DownloadsPanel } from "./DownloadsPanel";
import { DownloadsPopover } from "./DownloadsPopover";
import { BookmarksBar } from "./BookmarksBar";
import { MediaPlayer, type MediaState } from "./MediaPlayer";
import { Favicon } from "./Favicon";
import { OverflowMenu } from "./OverflowMenu";

type View = "web" | "settings" | "history" | "bookmarks" | "downloads";

export function App() {
  const [{ tabs, activeId }, setState] = useState<TabState>(loadTabs);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [view, setView] = useState<View>("web");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [dlItems, setDlItems] = useState<DownloadItem[]>([]);
  const [dlPopover, setDlPopover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mediaMenu, setMediaMenu] = useState(false);
  const [media, setMedia] = useState<MediaState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Mirror state into refs so the stable callbacks below always read fresh values.
  const stateRef = useRef<TabState>({ tabs, activeId });
  stateRef.current = { tabs, activeId };
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const settingsRef = useRef<Settings>(settings);
  settingsRef.current = settings;
  const dlPopoverRef = useRef(false);
  dlPopoverRef.current = dlPopover;
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  const mediaMenuRef = useRef(false);
  mediaMenuRef.current = mediaMenu;

  const holderRef = useRef<HTMLDivElement>(null);
  const addrRef = useRef<HTMLInputElement>(null);
  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const [addr, setAddr] = useState(activeTab?.url ?? settings.homepage);

  // ---- settings ----
  const updateSettings = useCallback((next: Settings) => setSettings(saveSettings(next)), []);

  // Drive HeroUI's theme via the <html> class.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", settings.theme === "dark");
    root.classList.toggle("light", settings.theme === "light");
  }, [settings.theme]);

  // Keep the window's always-on-top state in sync with the setting.
  useEffect(() => {
    win.setAlwaysOnTop(settings.alwaysOnTop).catch(() => {});
  }, [settings.alwaysOnTop]);

  // Push the website permission defaults to the backend; the interceptor on each
  // tab webview applies them (allow/block resolve silently, ask → engine prompt).
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const p of SITE_PERMISSIONS) map[String(p.kind)] = settings.sitePermissions[p.key] ?? "ask";
    api.setPermissions(map).catch(() => {});
  }, [settings.sitePermissions]);

  const toggleAlwaysOnTop = useCallback(
    () => setSettings((s) => saveSettings({ ...s, alwaysOnTop: !s.alwaysOnTop })),
    []
  );

  // ---- tab actions (all persist) ----
  const addTab = useCallback((url?: string) => {
    const s = settingsRef.current;
    const target = url ?? (s.openNewTabToHomepage ? s.homepage : NEWTAB);
    const t: Tab = { id: newId(), url: target, title: titleOf(target) };
    setState((st) => persistTabs({ tabs: [...st.tabs, t], activeId: t.id }));
    setView("web");
  }, []);

  const closeTab = useCallback((id: string) => {
    api.tabClose(id).catch(() => {});
    setMedia((m) => (m && m.tabId === id ? null : m));
    setState((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return s;
      let tabs = s.tabs.filter((t) => t.id !== id);
      let activeId = s.activeId;
      if (activeId === id) activeId = (s.tabs[idx + 1] ?? s.tabs[idx - 1])?.id ?? "";
      if (tabs.length === 0) {
        const t: Tab = { id: newId(), url: NEWTAB, title: "New tab" };
        tabs = [t];
        activeId = t.id;
      }
      return persistTabs({ tabs, activeId });
    });
  }, []);

  const activate = useCallback((id: string) => {
    setView("web");
    setState((s) => (s.activeId === id ? s : persistTabs({ ...s, activeId: id })));
  }, []);

  const setTabUrl = useCallback((id: string, url: string) => {
    // A real navigation drops the old page's media; the new page re-reports if any.
    setMedia((m) => (m && m.tabId === id ? null : m));
    setState((s) =>
      persistTabs({
        ...s,
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, url, title: titleOf(url) } : t)),
      })
    );
    setHistory(pushHistory(url, titleOf(url)));
  }, []);

  // The page reported its real <title>; show it on the tab (ignore blanks).
  const setTabTitle = useCallback((id: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    setState((s) => {
      const tab = s.tabs.find((x) => x.id === id);
      if (!tab || tab.title === t) return s;
      return persistTabs({ ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, title: t } : x)) });
    });
  }, []);

  // ---- tab drag ----
  // WebView2 escalates the tab drag to an OS drag, so the page never receives
  // dragover/drop — reordering can't use them. Instead, while a drag is in flight
  // we poll the NATIVE cursor position, map it into client coordinates, and
  // reorder live; on dragend we keep it if the cursor was last over the strip,
  // else route by window bounds. (HTML5 drag is kept only for its lifecycle —
  // dragend fires even when released outside the window, which tear-off needs.)
  const dragIdRef = useRef<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const geomRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const overStripRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Snapshot taken at dragstart: tab ids + their home left edges (CSS px), the
  // dragged index, tab width, and where in the tab the cursor grabbed. During the
  // drag we move tabs purely with transforms off this snapshot (no array changes,
  // so no jumps), then commit the new order on drop.
  const dragInfoRef = useRef<{ ids: string[]; lefts: number[]; width: number; from: number; grab: number } | null>(null);
  const lastInsRef = useRef(-1);

  const tabEl = (id: string) => stripRef.current?.querySelector<HTMLElement>(`[data-tabid="${CSS.escape(id)}"]`) ?? null;

  // Lay the strip out for cursor client-x `cx`: the dragged tab follows the cursor;
  // the others slide to open a gap at the insertion point. Returns that index.
  const layoutDrag = useCallback((cx: number, overStrip: boolean) => {
    const info = dragInfoRef.current;
    if (!info) return -1;
    const draggedId = info.ids[info.from];
    const dEl = tabEl(draggedId);
    if (dEl) {
      const homeCenter = info.lefts[info.from] + info.width / 2;
      dEl.style.transform = `translateX(${cx - info.grab - homeCenter}px)`;
    }
    let ins = info.from;
    if (overStrip) {
      ins = 0;
      info.ids.forEach((_, i) => {
        if (i !== info.from && cx > info.lefts[i] + info.width / 2) ins++;
      });
    }
    const others = info.ids.filter((_, i) => i !== info.from);
    const final = [...others.slice(0, ins), draggedId, ...others.slice(ins)];
    info.ids.forEach((id, i) => {
      if (i === info.from) return;
      const el = tabEl(id);
      if (el) el.style.transform = `translateX(${info.lefts[final.indexOf(id)] - info.lefts[i]}px)`;
    });
    return ins;
  }, []);

  const pendingDropRef = useRef(false);
  const clearDragStyles = useCallback(() => {
    stripRef.current?.querySelectorAll<HTMLElement>("[data-tabid]").forEach((el) => {
      el.style.transform = "";
      el.style.transition = "";
    });
  }, []);

  // After a drop commits the new order, clear the leftover transforms before the
  // browser paints (useLayoutEffect) so the tabs don't flash back to the old order.
  useLayoutEffect(() => {
    if (pendingDropRef.current) {
      pendingDropRef.current = false;
      clearDragStyles();
    }
  });

  const stopDragPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startDragPoll = useCallback(() => {
    stopDragPoll();
    win
      .selfGeometry()
      .then(([x, y, scale]) => (geomRef.current = { x, y, scale }))
      .catch(() => {});
    pollRef.current = setInterval(() => {
      if (!dragIdRef.current) return;
      win
        .cursorPosition()
        .then(([cx, cy]) => {
          const g = geomRef.current;
          const strip = stripRef.current;
          if (!g || !strip) return;
          const clientX = (cx - g.x) / g.scale;
          const clientY = (cy - g.y) / g.scale;
          const sr = strip.getBoundingClientRect();
          overStripRef.current =
            clientX >= sr.left - 8 && clientX <= sr.right + 40 && clientY >= sr.top - 12 && clientY <= sr.bottom + 30;
          lastInsRef.current = layoutDrag(clientX, overStripRef.current);
        })
        .catch(() => {});
    }, 30);
  }, [layoutDrag, stopDragPoll]);

  // On dragend: cursor last over the strip → commit the new order. Otherwise route
  // by the native cursor vs each window's bounds: over another window → move there;
  // within this window (page area) → keep; outside every window → new window.
  const onTabDragEnd = useCallback(
    (tab: Tab) => {
      stopDragPoll();
      const wasOverStrip = overStripRef.current;
      const ins = lastInsRef.current;
      const info = dragInfoRef.current;
      dragInfoRef.current = null;
      dragIdRef.current = null;
      overStripRef.current = false;
      setDragId(null);

      if (wasOverStrip) {
        // Commit the new order. If it actually changed, let the layout effect clear
        // the transforms after the re-render (no flash); otherwise clear them now.
        const cur = stateRef.current.tabs;
        const others = cur.filter((x) => x.id !== tab.id);
        const moved = cur.find((x) => x.id === tab.id);
        const next = info && ins >= 0 && moved ? [...others.slice(0, ins), moved, ...others.slice(ins)] : cur;
        if (!next.every((x, i) => x.id === cur[i]?.id)) {
          pendingDropRef.current = true;
          setState((s) => persistTabs({ ...s, tabs: next }));
        } else {
          clearDragStyles();
        }
        return; // reordered within the strip
      }
      clearDragStyles();
      Promise.all([win.cursorPosition(), win.windowBounds()])
        .then(([[cx, cy], bounds]) => {
          const inside = (b: { x: number; y: number; w: number; h: number }) =>
            cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
          const target = bounds.find((b) => b.label !== win.label && inside(b));
          if (target) {
            win.moveTabToWindow(target.label, tab.url).catch(() => {});
            closeTab(tab.id);
            return;
          }
          const self = bounds.find((b) => b.label === win.label);
          if (self && inside(self)) return; // within this window → keep
          if (stateRef.current.tabs.length <= 1 && tab.url === NEWTAB) return; // nothing to tear off
          win.newWindow(tab.url === NEWTAB ? undefined : tab.url).catch(() => {});
          closeTab(tab.id);
        })
        .catch(() => {});
    },
    [clearDragStyles, closeTab, stopDragPoll]
  );

  // Stop any in-flight drag poll if the component unmounts.
  useEffect(() => stopDragPoll, [stopDragPoll]);

  // ---- webview placement ----
  // Show the active tab at the placeholder bounds (creating it on about:blank if
  // new, then navigating to its url). Never runs while a panel covers the page.
  const sync = useCallback(() => {
    if (viewRef.current !== "web") return;
    const { activeId, tabs } = stateRef.current;
    const active = tabs.find((t) => t.id === activeId);
    // The New Tab / blank page has no native webview — park everything and let
    // the React overlay show instead.
    if (!activeId || !active || active.url === NEWTAB) {
      api.hideAll().catch(() => {});
      return;
    }
    const el = holderRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return; // wait for a real layout
    // Shrink the webview to free a right-hand strip for the overflow menu /
    // downloads popover, instead of hiding the whole page behind them (a native
    // webview can't be drawn under host DOM).
    const reserve = menuOpenRef.current
      ? 290
      : dlPopoverRef.current
        ? 384
        : mediaMenuRef.current
          ? 230
          : 0;
    const width = Math.max(200, r.width - reserve);
    api
      .tabShow(activeId, r.left, r.top, width, r.height)
      .then((created) => {
        if (created) {
          const t = stateRef.current.tabs.find((t) => t.id === activeId);
          api.tabNavigate(activeId, t?.url || settingsRef.current.homepage).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Show the active tab when on the web view; park everything when a panel or the
  // downloads popover is up (so that host-DOM UI isn't hidden by the webview).
  useEffect(() => {
    if (view === "web") sync();
    else api.hideAll().catch(() => {});
  }, [view, activeId, sync, dlPopover, menuOpen, mediaMenu]);

  // Close the media menu when the media goes away (track ended / tab closed).
  useEffect(() => {
    if (!media) setMediaMenu(false);
  }, [media]);

  // Keep bounds in sync with the layout; park everything when unmounting.
  useEffect(() => {
    const raf = requestAnimationFrame(sync);
    const t1 = setTimeout(sync, 250);
    const t2 = setTimeout(sync, 800);
    const ro = new ResizeObserver(() => sync());
    if (holderRef.current) ro.observe(holderRef.current);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      window.removeEventListener("resize", sync);
      api.hideAll().catch(() => {});
    };
  }, [sync]);

  // Reflect the active tab's url in the address bar (blank on the New Tab page).
  useEffect(() => {
    const u = activeTab?.url;
    setAddr(u && u !== NEWTAB ? u : "");
  }, [activeId, activeTab?.url]);

  // Events from the webviews. listen() is async, so under React StrictMode's
  // mount→unmount→remount the cleanup can run before a listen promise resolves —
  // leaking the first listener so handlers fire twice (e.g. a Ctrl/middle click
  // opening the same link in two tabs). The `disposed` flag makes a late-resolving
  // registration unlisten itself immediately.
  useEffect(() => {
    let disposed = false;
    const uns: Array<() => void> = [];
    const track = (p: Promise<() => void>) =>
      p.then((f) => (disposed ? f() : uns.push(f))).catch(() => {});
    track(events.onNav((e) => setTabUrl(e.id, e.url)));
    track(events.onNewTab((url) => addTab(url)));
    track(events.onTitle((e) => setTabTitle(e.id, e.title)));
    track(events.onMainShown(() => sync()));
    // Shortcuts forwarded from a focused tab page (the host keydown listener
    // can't see keys while a tab webview has focus).
    track(
      events.onShortcut((s) => {
        if (s.cmd === "newtab") addTab();
        else if (s.cmd === "closetab") closeTab(s.id);
        else if (s.cmd === "newwindow") win.newWindow().catch(() => {});
        else if (s.cmd === "newwindowurl") win.newWindow(s.arg).catch(() => {});
        else if (s.cmd === "search") {
          const u = toUrl(s.arg, settingsRef.current.searchEngine);
          if (u) addTab(u);
        } else if (s.cmd === "media") {
          try {
            const st = JSON.parse(s.arg) as Omit<MediaState, "tabId">;
            if (st.has) setMedia({ tabId: s.id, ...st });
            else setMedia((m) => (m && m.tabId === s.id ? null : m));
          } catch {
            /* ignore malformed media state */
          }
        } else if (s.cmd === "settings") setView((v) => (v === "settings" ? "web" : "settings"));
        else if (s.cmd === "focusurl") {
          setView("web");
          setDlPopover(false);
          setTimeout(() => {
            addrRef.current?.focus();
            addrRef.current?.select();
          }, 30);
        }
      })
    );
    return () => {
      disposed = true;
      uns.forEach((f) => f());
    };
  }, [addTab, closeTab, setTabUrl, setTabTitle, sync]);

  // Download manager: seed the list, push the persisted batch limit, and keep
  // the list live from the backend (full snapshot on change + byte progress).
  useEffect(() => {
    let disposed = false;
    const uns: Array<() => void> = [];
    const track = (p: Promise<() => void>) =>
      p.then((f) => (disposed ? f() : uns.push(f))).catch(() => {});
    downloads.list().then(setDlItems).catch(() => {});
    downloads.setMaxConcurrent(settingsRef.current.maxConcurrentDownloads).catch(() => {});
    track(downloadEvents.onChanged((items) => setDlItems(items)));
    track(
      downloadEvents.onProgress((p) =>
        setDlItems((prev) =>
          prev.map((it) => (it.id === p.id ? { ...it, received: p.received, total: p.total } : it))
        )
      )
    );
    return () => {
      disposed = true;
      uns.forEach((f) => f());
    };
  }, []);

  // ---- handlers ----
  const evalActive = useCallback((action: TabAction) => {
    setView("web");
    const { activeId } = stateRef.current;
    if (activeId) api.tabEval(activeId, action).catch(() => {});
  }, []);

  // Navigate the active tab to a real URL. The active tab may be a New Tab page
  // with no webview yet, so create/show it via tabShow before navigating, and
  // optimistically update the tab so the New Tab overlay hides immediately.
  const openInActiveTab = useCallback(
    (u: string) => {
      const { activeId } = stateRef.current;
      if (!activeId) {
        addTab(u);
        return;
      }
      setView("web");
      setState((s) =>
        persistTabs({
          ...s,
          tabs: s.tabs.map((t) => (t.id === activeId ? { ...t, url: u, title: titleOf(u) } : t)),
        })
      );
      const go = () => api.tabNavigate(activeId, u).catch(() => {});
      const r = holderRef.current?.getBoundingClientRect();
      if (r && r.width >= 1 && r.height >= 1) {
        api.tabShow(activeId, r.left, r.top, r.width, r.height).then(go, go);
      } else {
        go();
      }
    },
    [addTab]
  );

  // A window opened via "Open link in new window" starts on the given url.
  useEffect(() => {
    win
      .takePendingOpen()
      .then((u) => {
        if (u) openInActiveTab(u);
      })
      .catch(() => {});
  }, [openInActiveTab]);

  const navTo = useCallback(
    (raw: string) => {
      const u = toUrl(raw, settingsRef.current.searchEngine);
      if (u) openInActiveTab(u);
    },
    [openInActiveTab]
  );

  // Switch the active tab to the New Tab / blank page (no webview).
  const goToNewTab = useCallback(() => {
    const { activeId } = stateRef.current;
    if (!activeId) {
      addTab(NEWTAB);
      return;
    }
    setView("web");
    setState((s) =>
      persistTabs({
        ...s,
        tabs: s.tabs.map((t) => (t.id === activeId ? { ...t, url: NEWTAB, title: "New tab" } : t)),
      })
    );
    api.hideAll().catch(() => {});
  }, [addTab]);

  const goHome = useCallback(() => {
    if (settingsRef.current.homepage === NEWTAB) goToNewTab();
    else openInActiveTab(settingsRef.current.homepage);
  }, [goToNewTab, openInActiveTab]);

  const toggleCurrentBookmark = useCallback(() => {
    const s = stateRef.current;
    const t = s.tabs.find((x) => x.id === s.activeId);
    if (!t || !t.url || t.url === "about:blank" || t.url === NEWTAB) return;
    setBookmarks(toggleBookmark(t.url, t.title || titleOf(t.url)));
  }, []);

  const openPanel = useCallback((v: View) => {
    if (v === "history") setHistory(loadHistory());
    if (v === "bookmarks") setBookmarks(loadBookmarks());
    setDlPopover(false);
    setMenuOpen(false);
    setView(v);
  }, []);

  const clearAll = useCallback(() => {
    setHistory(clearHistory());
    setBookmarks(clearBookmarks());
  }, []);

  const openUrlsInNewTabs = useCallback((urls: string[]) => urls.forEach((u) => addTab(u)), [addTab]);

  // Persist the queue's batch limit and push it to the backend.
  const setMaxDownloads = useCallback((n: number) => {
    const clamped = Math.max(1, Math.min(10, Math.round(n)));
    setSettings((s) => saveSettings({ ...s, maxConcurrentDownloads: clamped }));
    downloads.setMaxConcurrent(clamped).catch(() => {});
  }, []);

  const activeDownloads = dlItems.filter(
    (d) => d.status === "active" || d.status === "paused" || d.status === "queued"
  ).length;

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "t") {
        e.preventDefault();
        addTab();
      } else if (ctrl && k === "w") {
        e.preventDefault();
        const id = stateRef.current.activeId;
        if (id) closeTab(id);
      } else if (ctrl && k === "l") {
        e.preventDefault();
        setView("web");
        setTimeout(() => {
          addrRef.current?.focus();
          addrRef.current?.select();
        }, 0);
      } else if ((ctrl && k === "r") || k === "f5") {
        e.preventDefault();
        evalActive("reload");
      } else if (ctrl && k === ",") {
        e.preventDefault();
        setView((v) => (v === "settings" ? "web" : "settings"));
      } else if (ctrl && k === "n" && !e.shiftKey) {
        e.preventDefault();
        win.newWindow().catch(() => {});
      } else if (ctrl && e.shiftKey && k === "b") {
        e.preventDefault();
        setSettings((s) => saveSettings({ ...s, showBookmarksBar: !s.showBookmarksBar }));
      } else if (e.altKey && k === "arrowleft") {
        e.preventDefault();
        evalActive("back");
      } else if (e.altKey && k === "arrowright") {
        e.preventDefault();
        evalActive("forward");
      } else if (k === "escape") {
        if (mediaMenuRef.current) setMediaMenu(false);
        else if (menuOpenRef.current) setMenuOpen(false);
        else if (dlPopoverRef.current) setDlPopover(false);
        else if (viewRef.current !== "web") setView("web");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addTab, closeTab, evalActive]);

  // Suppress the engine's native context menu in the host chrome, except in text
  // fields (cut/copy/paste). Tab pages render their own menu (see browser::TAB_JS).
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const editable = !!t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (!editable) e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);

  const currentBookmarked = !!activeTab && isBookmarked(activeTab.url, bookmarks);

  return (
    <div className="flex h-full flex-col">
      {/* Tab strip doubles as the custom title bar (native decorations are off). */}
      <div className="flex select-none items-stretch bg-content1">
        <div
          ref={stripRef}
          className="no-scrollbar flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto px-2 pt-1.5"
          // The strip has no vertical scroll, so map wheel to horizontal: tabs
          // keep their full width and overflow stays reachable (the bar's own
          // scrollbar is hidden).
          onWheel={(e) => {
            const el = e.currentTarget;
            if (el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY + e.deltaX;
          }}
        >
          {tabs.map((t) => (
            <div
              key={t.id}
              data-tabid={t.id}
              // All tabs share one width: 180px while they fit, shrinking together
              // (uniformly, down to a 72px floor) only when the strip overflows.
              className={
                "group flex min-w-[72px] max-w-[180px] flex-[0_1_180px] cursor-default items-center gap-2 whitespace-nowrap rounded-t-lg px-2.5 py-2 text-[12.5px] transition-colors " +
                (t.id === activeId
                  ? "bg-background text-foreground"
                  : "text-foreground-500 hover:bg-content2 hover:text-foreground") +
                (t.id === dragId ? " relative z-50 bg-content2 shadow-lg ring-2 ring-primary ring-inset" : "")
              }
              draggable
              onDragStart={(e) => {
                const strip = stripRef.current;
                if (!strip) return;
                const els = Array.from(strip.querySelectorAll<HTMLElement>("[data-tabid]"));
                const ids = els.map((el) => el.dataset.tabid as string);
                const lefts = els.map((el) => el.getBoundingClientRect().left);
                const from = ids.indexOf(t.id);
                const rect = els[from]?.getBoundingClientRect();
                const width = rect?.width ?? 180;
                // Where in the tab the cursor grabbed (clientX is reliable at start);
                // if it's bogus (outside the tab), just center the tab on the cursor.
                let grab = rect ? e.clientX - (rect.left + width / 2) : 0;
                if (Math.abs(grab) > width / 2) grab = 0;
                dragInfoRef.current = { ids, lefts, width, from, grab };
                lastInsRef.current = from;
                dragIdRef.current = t.id;
                overStripRef.current = true;
                setDragId(t.id);
                // Dragged tab follows the cursor instantly; the rest slide smoothly.
                els.forEach((el) => {
                  el.style.transition = el.dataset.tabid === t.id ? "none" : "transform 0.16s ease";
                });
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", t.url);
                startDragPoll();
              }}
              onDragEnd={() => onTabDragEnd(t)}
              onClick={() => activate(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(t.id);
                }
              }}
              title={t.title || t.url}
            >
              {settings.showSiteIcons && t.url !== NEWTAB && <Favicon url={t.url} size={15} />}
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis">{t.title || t.url}</span>
              <span
                className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded opacity-60 transition hover:bg-content3 hover:opacity-100"
                role="button"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                <X size={12} />
              </span>
            </div>
          ))}
          <button
            className="mb-0.5 inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md text-foreground-500 transition-colors hover:bg-content2 hover:text-foreground"
            title="New tab"
            onClick={() => addTab()}
          >
            <Plus size={14} />
          </button>
          {/* Draggable filler: absorbs free space so tabs stay 180px until they
              must shrink, and gives the window a drag handle. */}
          <div className="min-w-0 flex-1 self-stretch" data-tauri-drag-region />
        </div>

        {/* Custom window controls. */}
        <div className="flex shrink-0 items-stretch">
          <button
            className={
              "inline-flex w-[46px] items-center justify-center transition-colors " +
              (settings.alwaysOnTop
                ? "bg-content2 text-primary"
                : "text-foreground-500 hover:bg-content2 hover:text-foreground")
            }
            title={settings.alwaysOnTop ? "Always on top: on" : "Always on top"}
            aria-label="Always on top"
            aria-pressed={settings.alwaysOnTop}
            onClick={toggleAlwaysOnTop}
          >
            <Pin size={14} className={settings.alwaysOnTop ? "fill-current" : ""} />
          </button>
          <button
            className="inline-flex w-[46px] items-center justify-center text-foreground-500 transition-colors hover:bg-content2 hover:text-foreground"
            title="Minimize"
            aria-label="Minimize"
            onClick={() => win.minimize()}
          >
            <Minus size={15} />
          </button>
          <button
            className="inline-flex w-[46px] items-center justify-center text-foreground-500 transition-colors hover:bg-content2 hover:text-foreground"
            title="Maximize"
            aria-label="Maximize"
            onClick={() => win.toggleMaximize()}
          >
            <Square size={12} />
          </button>
          <button
            className="inline-flex w-[46px] items-center justify-center text-foreground-500 transition-colors hover:bg-danger hover:text-white"
            title="Close"
            aria-label="Close"
            onClick={() => win.close()}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Nav bar */}
      <div className="flex items-center gap-1.5 border-b border-divider bg-background px-2.5 py-2">
        <Button isIconOnly variant="light" size="sm" title="Back" aria-label="Back" onPress={() => evalActive("back")}>
          <ChevronLeft size={18} />
        </Button>
        <Button isIconOnly variant="light" size="sm" title="Forward" aria-label="Forward" onPress={() => evalActive("forward")}>
          <ChevronRight size={18} />
        </Button>
        <Button isIconOnly variant="light" size="sm" title="Reload" aria-label="Reload" onPress={() => evalActive("reload")}>
          <RotateCw size={16} />
        </Button>
        <Button isIconOnly variant="light" size="sm" title="Home" aria-label="Home" onPress={goHome}>
          <Home size={16} />
        </Button>

        {media && media.has && (
          <MediaPlayer
            media={media}
            onPlayPause={() => {
              setMedia((m) => (m ? { ...m, playing: !m.playing } : m));
              api.tabMedia(media.tabId, "playpause").catch(() => {});
            }}
            onGoToTab={() => activate(media.tabId)}
            onContextMenu={() => {
              setView("web");
              setDlPopover(false);
              setMenuOpen(false);
              setMediaMenu(true);
            }}
          />
        )}

        <Input
          ref={addrRef}
          className="flex-1"
          classNames={{ inputWrapper: "h-9 address-input" }}
          radius="full"
          size="sm"
          variant="flat"
          spellCheck="false"
          value={addr}
          onValueChange={setAddr}
          onKeyDown={(e) => {
            if (e.key === "Enter") navTo(addr);
          }}
          placeholder="Search or enter a URL"
          startContent={<Search size={15} className="text-foreground-500" />}
          aria-label="Address bar"
        />

        <Button
          isIconOnly
          variant="light"
          size="sm"
          title={currentBookmarked ? "Remove bookmark" : "Bookmark this page"}
          aria-label="Bookmark"
          onPress={toggleCurrentBookmark}
        >
          <Star size={17} className={currentBookmarked ? "fill-warning text-warning" : ""} />
        </Button>
        <Button isIconOnly variant="light" size="sm" title="Go" aria-label="Go" onPress={() => navTo(addr)}>
          <ArrowRight size={18} />
        </Button>

        <div className="mx-0.5 h-6 w-px shrink-0 bg-divider" />

        <Button isIconOnly variant="light" size="sm" title="Bookmarks" aria-label="Bookmarks" onPress={() => openPanel("bookmarks")}>
          <BookmarkIcon size={17} />
        </Button>
        <Button isIconOnly variant="light" size="sm" title="History" aria-label="History" onPress={() => openPanel("history")}>
          <HistoryIcon size={17} />
        </Button>
        <Badge
          color="primary"
          size="sm"
          content={activeDownloads}
          isInvisible={activeDownloads === 0}
          placement="top-right"
        >
          <Button
            isIconOnly
            variant="light"
            size="sm"
            title="Downloads"
            aria-label="Downloads"
            onPress={() => {
              setView("web");
              setMenuOpen(false);
              setDlPopover((o) => !o);
            }}
          >
            <Download size={17} />
          </Button>
        </Badge>
        <Button
          isIconOnly
          variant="light"
          size="sm"
          title="Menu"
          aria-label="Menu"
          onPress={() => {
            setView("web");
            setDlPopover(false);
            setMenuOpen((o) => !o);
          }}
        >
          <EllipsisVertical size={18} />
        </Button>
      </div>

      {/* Bookmarks bar (under the toolbar) */}
      {settings.showBookmarksBar && (
        <BookmarksBar bookmarks={bookmarks} onOpen={openInActiveTab} onOpenNewTab={addTab} />
      )}

      {/* Content: the active webview floats over this placeholder; the New Tab
          page and panels cover it (the webview is parked while they show). */}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 bg-content1" ref={holderRef} />
        {view === "web" && activeTab?.url === NEWTAB && (
          <NewTabPage
            searchEngine={settings.searchEngine}
            tempUnit={settings.tempUnit}
            weatherLocation={settings.weatherLocation}
            showWeather={settings.showWeather}
            showNews={settings.showNews}
            showSiteIcons={settings.showSiteIcons}
            background={settings.homeBackground}
            onNavigate={navTo}
          />
        )}
        {view === "settings" && (
          <SettingsPanel
            settings={settings}
            onChange={updateSettings}
            onClearHistory={() => setHistory(clearHistory())}
            onClearBookmarks={() => setBookmarks(clearBookmarks())}
            onClearAll={clearAll}
            onClose={() => setView("web")}
          />
        )}
        {view === "history" && (
          <HistoryPanel
            entries={history}
            onOpen={openInActiveTab}
            onOpenNewTabs={openUrlsInNewTabs}
            onDelete={(keys) => setHistory(removeHistoryKeys(new Set(keys)))}
            onClear={() => setHistory(clearHistory())}
            onClose={() => setView("web")}
          />
        )}
        {view === "bookmarks" && (
          <BookmarksPanel
            bookmarks={bookmarks}
            onOpen={openInActiveTab}
            onRemove={(url) => setBookmarks(removeBookmark(url))}
            onClose={() => setView("web")}
          />
        )}
        {view === "downloads" && (
          <DownloadsPanel
            items={dlItems}
            maxConcurrent={settings.maxConcurrentDownloads}
            onSetMaxConcurrent={setMaxDownloads}
            onClose={() => setView("web")}
          />
        )}

        {/* Quick-glance downloads popover (top-right). The webview is parked while
            it's open; click-away closes it. "Full download history" opens the page. */}
        {dlPopover && view === "web" && (
          <>
            <div className="anim-fade absolute inset-0 z-40" onClick={() => setDlPopover(false)} />
            <div className="absolute right-3 top-3 z-50">
              <DownloadsPopover
                items={dlItems}
                onOpenFull={() => {
                  setDlPopover(false);
                  setView("downloads");
                }}
                onClose={() => setDlPopover(false)}
              />
            </div>
          </>
        )}

        {/* Overflow (⋮) menu — collected toolbar actions. */}
        {menuOpen && view === "web" && (
          <>
            <div className="anim-fade absolute inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-3 top-3 z-50">
              <OverflowMenu
                showBookmarksBar={settings.showBookmarksBar}
                alwaysOnTop={settings.alwaysOnTop}
                onClose={() => setMenuOpen(false)}
                onNewTab={() => addTab()}
                onNewWindow={() => win.newWindow().catch(() => {})}
                onSettings={() => openPanel("settings")}
                onToggleBookmarksBar={() =>
                  setSettings((s) => saveSettings({ ...s, showBookmarksBar: !s.showBookmarksBar }))
                }
                onToggleAlwaysOnTop={toggleAlwaysOnTop}
              />
            </div>
          </>
        )}

        {/* Music-player context menu (right-click) — Picture-in-Picture etc. */}
        {mediaMenu && media && media.has && view === "web" && (
          <>
            <div className="anim-fade absolute inset-0 z-40" onClick={() => setMediaMenu(false)} />
            <div className="anim-pop absolute right-3 top-3 z-50 w-[230px] rounded-large border border-divider bg-content1 p-1.5 text-foreground shadow-2xl">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-medium px-3 py-2 text-sm text-foreground-700 transition-colors hover:bg-content2 hover:text-foreground"
                onClick={() => {
                  api.tabMedia(media.tabId, "pip").catch(() => {});
                  setMediaMenu(false);
                }}
              >
                <PictureInPicture2 size={16} className="text-foreground-500" />
                Picture in Picture
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-medium px-3 py-2 text-sm text-foreground-700 transition-colors hover:bg-content2 hover:text-foreground"
                onClick={() => {
                  activate(media.tabId);
                  setMediaMenu(false);
                }}
              >
                <SquareArrowOutUpRight size={16} className="text-foreground-500" />
                Go to tab
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
