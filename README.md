# riyo-browser

A small tabbed desktop browser built on **Tauri 2 + WebView2** — custom title bar,
a HeroUI interface, and a hardened, low-telemetry engine configuration.

## Features

- **Real tabs** — each tab is its own native webview, so page state survives switching, and the tab list persists across restarts
- **Custom title bar** — native decorations off; integrated tabs, drag region, and window controls
- **Smart address bar** — detects URLs vs. search queries (Google / Bing / DuckDuckGo)
- **New Tab page** — live clock, engine-aware search, frequently-used sites, current-location weather, and news with thumbnails
- **History, bookmarks, and a settings page** (homepage, search engine, theme, clear data)
- **Download manager** — page downloads are intercepted into a queue with a configurable batch limit (how many run at once), plus pause / resume / cancel / retry and live progress
- **Hardened engine** — background "phone-home" traffic (SmartScreen, component/variations updates, Domain Reliability, crash & autofill telemetry) is disabled
- **Keyboard shortcuts** — `Ctrl+T` / `Ctrl+W` / `Ctrl+L` / `Ctrl+R`, `Alt+←/→`, `Ctrl+,`

## Stack

React · TypeScript · Vite · HeroUI · Tailwind CSS · Tauri 2 (Rust)

## Run

Prerequisites: Node 18+, Rust, and the [Tauri 2 system deps](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

## Notes

Built and verified on **Windows + WebView2**. Embedding a live external site in a
Tauri window hits a few non-obvious pitfalls; the workarounds and architecture are
written up in [NOTES.md](NOTES.md).

## License

[MIT](LICENSE) © Riyoway
