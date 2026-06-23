# tauri-browser

A small, tabbed **in-app browser built on Tauri 2** — real tabs (each tab is its own
webview, so state is preserved on switch), open-in-new-tab via Ctrl/middle-click, and
tabs that persist across restarts.

It exists mostly as a **reference**: embedding a live, external website inside a Tauri
app hits a handful of non-obvious bugs, and this repo packages the workarounds that
actually make it work.

> No ad blocker, no app-specific glue — just the browser mechanics.

## What it does

- **Tabs as child webviews** — each tab is a native webview floated over a placeholder
  `<div>`; the active one is positioned to the placeholder's bounds, the rest are
  parked off-screen, so scroll position / playing video / form state survive a switch.
- **Ctrl-click / middle-click → new tab** on any link.
- **Persistence** — the tab list is saved to `localStorage`; closing/reopening (or
  restarting) restores the tabs (the active page reloads).
- **Address bar + back / forward / reload / home**, acting on the active tab.
- **Close-to-tray** with a Show / Quit tray menu.

## The Tauri-2 gotchas this works around

These cost real time to discover; the fixes live in
[`src-tauri/src/browser.rs`](src-tauri/src/browser.rs).

| Symptom | Cause | Fix |
| --- | --- | --- |
| App **freezes** when opening a webview | Creating a webview from a **synchronous** command deadlocks the main thread on Windows ([tauri#12032](https://github.com/tauri-apps/tauri/issues/12032)) | Make the command **`async`** |
| Webview renders **blank** on an external site | A child webview created straight on an external URL often doesn't paint ([tauri#10011](https://github.com/tauri-apps/tauri/issues/10011)); local pages do | Create on **`about:blank`**, then **navigate** to the real URL |
| Can't react to **Ctrl/middle-click** in the page | A remote page can't call back into the app | Init script navigates to a **sentinel URL** that `on_navigation` **cancels + forwards** |
| Window **won't re-open** from the tray after a while; `Failed to unregister class Chrome_WidgetWin_0` | Long-lived child webviews on a hidden window block the re-show ([tauri#9798](https://github.com/tauri-apps/tauri/issues/9798)) | **Close the tab webviews before hiding**; recreate from the saved list on `main-shown` |

Multiple webviews per window also require Tauri's **`unstable`** Cargo feature
(`Window::add_child`) — see `src-tauri/Cargo.toml`.

## How it fits together

```
React (the main webview)                 Rust
┌─────────────────────────┐
│ tab strip + nav bar      │  invoke ─▶  browser_tab_show(id, x,y,w,h)  → add_child / position
│ placeholder <div> ───────┼──bounds──▶  browser_tab_navigate(id, url)
│                          │  ◀─event──  "browser-nav" {id,url}  (address bar / titles)
│                          │  ◀─event──  "browser-new-tab" url   (ctrl/middle-click)
└─────────────────────────┘  ◀─event──  "main-shown"            (recreate active tab)
        ▲  native tab webview is drawn on top of the placeholder
```

- Frontend: [`src/App.tsx`](src/App.tsx) (tab UI + webview placement),
  [`src/tabs.ts`](src/tabs.ts) (model + persistence), [`src/ipc.ts`](src/ipc.ts).
- Backend: [`src-tauri/src/browser.rs`](src-tauri/src/browser.rs) (commands),
  [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs) (tray + close-to-tray).

## Run it

Prerequisites: Node 18+, Rust, and the
[Tauri 2 system deps](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

App icons are already generated (in `src-tauri/icons/`). To use your own, replace
`app-icon.png` with any square PNG and regenerate:

```bash
npm run tauri icon app-icon.png
```

## Notes & limits

- Built/verified on **Windows + WebView2**; the multi-webview path is least mature
  there, which is exactly why the workarounds above exist. macOS/Linux should be
  fine but are less exercised.
- Multi-webview is behind Tauri's `unstable` feature — APIs may shift between Tauri
  releases.
- Live page state isn't preserved across an app restart (only the tab URLs are);
  parking an inactive tab keeps it alive within a session.

## License

MIT
