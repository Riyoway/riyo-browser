import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Input } from "@heroui/react";
import {
  AppWindow,
  ArrowRight,
  Bookmark as BookmarkIcon,
  ChevronLeft,
  ChevronRight,
  Download,
  History as HistoryIcon,
  Home,
  Minus,
  Pin,
  Plus,
  RotateCw,
  Search,
  Settings as SettingsIcon,
  Square,
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
import { loadSettings, saveSettings, toUrl, type Settings } from "./settings";
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

type View = "web" | "settings" | "history" | "bookmarks" | "downloads";

export function App() {
  const [{ tabs, activeId }, setState] = useState<TabState>(loadTabs);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [view, setView] = useState<View>("web");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [dlItems, setDlItems] = useState<DownloadItem[]>([]);
  const [dlPopover, setDlPopover] = useState(false);

  // Mirror state into refs so the stable callbacks below always read fresh values.
  const stateRef = useRef<TabState>({ tabs, activeId });
  stateRef.current = { tabs, activeId };
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const settingsRef = useRef<Settings>(settings);
  settingsRef.current = settings;
  const dlPopoverRef = useRef(false);
  dlPopoverRef.current = dlPopover;

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
    setState((s) =>
      persistTabs({
        ...s,
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, url, title: titleOf(url) } : t)),
      })
    );
    setHistory(pushHistory(url, titleOf(url)));
  }, []);

  // ---- webview placement ----
  // Show the active tab at the placeholder bounds (creating it on about:blank if
  // new, then navigating to its url). Never runs while a panel covers the page.
  const sync = useCallback(() => {
    if (viewRef.current !== "web" || dlPopoverRef.current) return;
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
    api
      .tabShow(activeId, r.left, r.top, r.width, r.height)
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
    if (view === "web" && !dlPopover) sync();
    else api.hideAll().catch(() => {});
  }, [view, activeId, sync, dlPopover]);

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
    track(events.onMainShown(() => sync()));
    // Shortcuts forwarded from a focused tab page (the host keydown listener
    // can't see keys while a tab webview has focus).
    track(
      events.onShortcut((s) => {
        if (s.cmd === "newtab") addTab();
        else if (s.cmd === "closetab") closeTab(s.id);
        else if (s.cmd === "newwindow") win.newWindow().catch(() => {});
        else if (s.cmd === "search") {
          const u = toUrl(s.arg, settingsRef.current.searchEngine);
          if (u) addTab(u);
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
  }, [addTab, closeTab, setTabUrl, sync]);

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
        if (dlPopoverRef.current) setDlPopover(false);
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
        <div className="no-scrollbar flex min-w-0 flex-[0_1_auto] items-end gap-0.5 overflow-x-auto px-2 pt-1.5">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={
                "group flex w-[180px] flex-[0_0_180px] cursor-default items-center gap-2 whitespace-nowrap rounded-t-lg px-2.5 py-2 text-[12.5px] transition-colors " +
                (t.id === activeId
                  ? "bg-background text-foreground"
                  : "text-foreground-500 hover:bg-content2 hover:text-foreground")
              }
              onClick={() => activate(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(t.id);
                }
              }}
              title={t.url}
            >
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
        </div>

        {/* Draggable empty area between the tabs and the window controls. */}
        <div className="min-w-[24px] flex-1 self-stretch" data-tauri-drag-region />

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

        <Button
          isIconOnly
          variant="light"
          size="sm"
          title="New window (Ctrl+N)"
          aria-label="New window"
          onPress={() => win.newWindow().catch(() => {})}
        >
          <AppWindow size={17} />
        </Button>
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
              setDlPopover((o) => !o);
            }}
          >
            <Download size={17} />
          </Button>
        </Badge>
        <Button isIconOnly variant="light" size="sm" title="Settings" aria-label="Settings" onPress={() => openPanel("settings")}>
          <SettingsIcon size={17} />
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
      </div>
    </div>
  );
}
