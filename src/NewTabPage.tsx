import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { SEARCH_ENGINE_LABEL, type SearchEngine, type TempUnit } from "./settings";
import {
  cachedNews,
  cachedWeather,
  faviconUrls,
  fetchNews,
  fetchWeather,
  NEWS_CATEGORIES,
  topSites,
  type IconBucket,
  type NewsCategory,
  type NewsItem,
  type Weather,
} from "./newtabData";

// The built-in New Tab / blank page (from the "Blank Page" design): clock,
// greeting, engine-aware search, frequently-used sites with favicons, live
// weather for the current location, live news with thumbnails, calendar, and a
// persisted to-do list. Rendered as a React overlay in the host webview while
// the native tab webview is parked.

interface NewTabPageProps {
  searchEngine: SearchEngine;
  tempUnit: TempUnit;
  weatherLocation: string;
  /** Open raw address-bar input in the active tab (URL or search query). */
  onNavigate: (input: string) => void;
}

interface Todo {
  text: string;
  done: boolean;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function WeatherIcon({ cond }: { cond: IconBucket }) {
  const p = {
    width: 26,
    height: 26,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#cccccc",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (cond === "sun")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    );
  if (cond === "partly")
    return (
      <svg {...p}>
        <circle cx="8" cy="7" r="3" />
        <path d="M8 1.5v1M2.6 4.6l.7.7M13.4 4.6l-.7.7M1.5 10h1" />
        <path d="M19 13h-1.05A6 6 0 1 0 9 19h10a3.5 3.5 0 0 0 0-7z" />
      </svg>
    );
  if (cond === "fog")
    return (
      <svg {...p}>
        <path d="M5 8h14M3 12h18M5 16h14M8 20h11" />
      </svg>
    );
  if (cond === "rain")
    return (
      <svg {...p}>
        <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
        <path d="M8 19v2M12 19v3M16 19v2" />
      </svg>
    );
  if (cond === "snow")
    return (
      <svg {...p}>
        <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
        <path d="M8 19h.01M12 21h.01M16 19h.01M10 22h.01M14 22h.01" />
      </svg>
    );
  if (cond === "thunder")
    return (
      <svg {...p}>
        <path d="M19 16.9A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
        <path d="M13 11l-4 6h4l-2 4" />
      </svg>
    );
  // cloud (default)
  return (
    <svg {...p}>
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

/** Site favicon with a DuckDuckGo -> Google -> letter-monogram fallback chain. */
function Favicon({ host, mono }: { host: string; mono: string }) {
  const urls = host ? faviconUrls(host) : [];
  const [stage, setStage] = useState(0);
  if (!host || stage >= urls.length) {
    return <span style={{ fontSize: 20, fontWeight: 500, color: "#d4d4d4" }}>{mono}</span>;
  }
  return (
    <img
      src={urls[stage]}
      alt=""
      width={26}
      height={26}
      style={{ borderRadius: 6 }}
      onError={() => setStage((s) => s + 1)}
    />
  );
}

/** News thumbnail that collapses to a neutral box if the image fails to load. */
function NewsThumb({ src }: { src: string }) {
  const [ok, setOk] = useState(true);
  // Reset when the image url changes (a background refresh can swap a failed
  // thumbnail for a working one on a same-keyed row).
  useEffect(() => setOk(true), [src]);
  const box: CSSProperties = { width: 88, height: 60, borderRadius: 8, flex: "none", background: "#1a1a1a" };
  if (!src || !ok) return <div style={box} />;
  return <img src={src} alt="" onError={() => setOk(false)} style={{ ...box, objectFit: "cover" }} />;
}

function buildWeeks(now: Date) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = now.getDate();
  const startDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: { label: string; isToday: boolean }[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7).map((d) => ({ label: d ? String(d) : "", isToday: d === today })));
  }
  return weeks;
}

const card: CSSProperties = {
  background: "#121212",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 16,
};
const cardLabel: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.4px",
  color: "#bcbcbc",
  textTransform: "uppercase",
};
const muted: CSSProperties = { fontSize: 13, color: "#6a6a6a", padding: "16px 0" };

export function NewTabPage({ searchEngine, tempUnit, weatherLocation, onNavigate }: NewTabPageProps) {
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<NewsCategory>("Top");
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const sites = useMemo(() => topSites(8), []);

  const [weather, setWeather] = useState<Weather | null>(() => cachedWeather(weatherLocation, tempUnit));
  const [weatherErr, setWeatherErr] = useState(false);

  const [newsByCat, setNewsByCat] = useState<Record<string, NewsItem[]>>(() => {
    const init: Record<string, NewsItem[]> = {};
    const c = cachedNews("Top");
    if (c) init.Top = c;
    return init;
  });
  const [newsErr, setNewsErr] = useState(false);

  // Clock tick + load persisted to-dos + focus the search box.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    try {
      const s = localStorage.getItem("blankpage.todos");
      if (s) setTodos(JSON.parse(s));
    } catch {
      /* ignore */
    }
    searchRef.current?.focus();
    return () => clearInterval(t);
  }, []);

  // Weather: use a fresh cache as-is (no network); otherwise fetch and refresh.
  useEffect(() => {
    let alive = true;
    setWeatherErr(false);
    const fresh = cachedWeather(weatherLocation, tempUnit);
    if (fresh) {
      setWeather(fresh);
      return;
    }
    fetchWeather(weatherLocation, tempUnit)
      .then((w) => {
        if (alive) setWeather(w);
      })
      .catch(() => {
        if (alive && !cachedWeather(weatherLocation, tempUnit)) {
          setWeather(null);
          setWeatherErr(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [tempUnit, weatherLocation]);

  // News: use a fresh cache as-is; otherwise fetch the feed via the proxy.
  useEffect(() => {
    let alive = true;
    setNewsErr(false);
    const cached = cachedNews(category);
    if (cached) {
      setNewsByCat((m) => ({ ...m, [category]: cached }));
      return;
    }
    fetchNews(category)
      .then((items) => {
        if (alive) setNewsByCat((m) => ({ ...m, [category]: items }));
      })
      .catch(() => {
        if (alive && !cachedNews(category)) setNewsErr(true);
      });
    return () => {
      alive = false;
    };
  }, [category]);

  const saveTodos = (next: Todo[]) => {
    try {
      localStorage.setItem("blankpage.todos", JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setTodos(next);
  };

  const hh = now.getHours();
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ampm = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const time = `${h12}:${mm}`;
  const greeting = hh < 12 ? "Good morning" : hh < 18 ? "Good afternoon" : "Good evening";
  const dateStr = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
  const monthLabel = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const engineLabel = SEARCH_ENGINE_LABEL[searchEngine];

  const weeks = buildWeeks(now);
  const news = newsByCat[category];
  const remaining = todos.filter((t) => !t.done).length;
  const todoSummary = todos.length === 0 ? "" : `${remaining} of ${todos.length} left`;

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) onNavigate(q);
  };
  const submitTodo = (e: FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    setDraft("");
    saveTodos([...todos, { text: v, done: false }]);
  };

  return (
    <div
      className="ntp absolute inset-0 z-40 overflow-auto"
      style={{
        background: "#0a0a0a",
        color: "#ededed",
        fontFamily: "'Helvetica Neue',Helvetica,Arial,system-ui,sans-serif",
      }}
    >
      <div
        style={{
          minHeight: "100%",
          padding: "64px 32px 80px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Clock + greeting + search */}
        <div style={{ width: "100%", maxWidth: 1120, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              fontWeight: 200,
              letterSpacing: "-3px",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span style={{ fontSize: "clamp(64px,9vw,112px)" }}>{time}</span>
            <span style={{ fontSize: 22, fontWeight: 400, letterSpacing: 0, color: "#7a7a7a", marginTop: 14 }}>{ampm}</span>
          </div>
          <div style={{ marginTop: 18, fontSize: 22, fontWeight: 300 }}>{greeting}</div>
          <div style={{ marginTop: 6, fontSize: 14, color: "#6a6a6a", letterSpacing: "0.3px" }}>{dateStr}</div>

          <form onSubmit={submitSearch} style={{ width: "100%", maxWidth: 600, marginTop: 36 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                background: "#1c1c1c",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 999,
                padding: "0 22px",
                height: 54,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7a7a7a" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${engineLabel} or type a URL`}
                spellCheck={false}
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#ededed", fontSize: 15, fontFamily: "inherit" }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: "#5a5a5a",
                  letterSpacing: "0.5px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  padding: "3px 7px",
                  whiteSpace: "nowrap",
                }}
              >
                {engineLabel}
              </span>
            </div>
          </form>
        </div>

        {/* Frequently-used sites */}
        <div style={{ width: "100%", maxWidth: 1120, marginTop: 48, display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center" }}>
          {sites.map((s) => (
            <button
              key={s.host + s.url}
              className="ntp-shortcut"
              onClick={() => onNavigate(s.url)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 9, width: 82 }}
            >
              <div
                className="ntp-shortcut-icon"
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 15,
                  background: "#161616",
                  border: "1px solid rgba(255,255,255,0.07)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Favicon host={s.host} mono={(s.name[0] || "?").toUpperCase()} />
              </div>
              <span style={{ fontSize: 12, color: "#8a8a8a", maxWidth: 82, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            </button>
          ))}
        </div>

        {/* Weather */}
        <div style={{ ...card, width: "100%", maxWidth: 1120, marginTop: 40, padding: "22px 26px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={cardLabel}>Weather</span>
            <span style={{ fontSize: 13, color: "#7a7a7a" }}>
              {weather ? `${weather.currentTemp}${weather.unitSymbol} · ${weather.locationLabel}` : ""}
            </span>
          </div>
          {weather ? (
            <div style={{ display: "flex", gap: 6, marginTop: 18 }}>
              {weather.days.map((d, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 11, padding: "6px 0" }}>
                  <span style={{ fontSize: 11, color: "#8a8a8a", textTransform: "uppercase", letterSpacing: "0.6px" }}>{d.day}</span>
                  <div style={{ height: 28, display: "flex", alignItems: "center" }}>
                    <WeatherIcon cond={d.icon} />
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <span style={{ color: "#ededed" }}>{d.hi}&deg;</span>
                    <span style={{ color: "#5e5e5e", marginLeft: 2 }}>{d.lo}&deg;</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={muted}>{weatherErr ? "Couldn't load weather." : "Loading weather…"}</div>
          )}
        </div>

        {/* News + Calendar + To-do */}
        <div style={{ width: "100%", maxWidth: 1120, marginTop: 24, display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 24, alignItems: "start" }}>
          {/* News */}
          <div style={{ ...card, padding: "24px 26px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={cardLabel}>News</span>
            </div>
            <div style={{ display: "flex", gap: 20, borderBottom: "1px solid rgba(255,255,255,0.07)", paddingBottom: 2, overflowX: "auto" }}>
              {NEWS_CATEGORIES.map((c) => {
                const active = c === category;
                return (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 9px", fontSize: 13, fontFamily: "inherit", whiteSpace: "nowrap" }}
                  >
                    <span
                      style={
                        active
                          ? { color: "#ededed", fontWeight: 600, borderBottom: "2px solid #ededed", paddingBottom: 9 }
                          : { color: "#6a6a6a" }
                      }
                    >
                      {c}
                    </span>
                  </button>
                );
              })}
            </div>
            <div>
              {news ? (
                news.length === 0 ? (
                  <div style={muted}>No stories right now.</div>
                ) : (
                  news.map((n) => (
                    <button
                      key={n.url}
                      className="ntp-news"
                      onClick={() => onNavigate(n.url)}
                      style={{ display: "flex", gap: 14, alignItems: "center", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.045)" }}
                    >
                      <NewsThumb src={n.image} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 14, color: "#e4e4e4", lineHeight: 1.4 }}>{n.title}</span>
                        <span style={{ display: "block", fontSize: 12, color: "#6a6a6a", marginTop: 6 }}>
                          {n.source}
                          {n.time ? ` · ${n.time}` : ""}
                        </span>
                      </span>
                    </button>
                  ))
                )
              ) : (
                <div style={muted}>{newsErr ? "Couldn't load news." : "Loading…"}</div>
              )}
            </div>
          </div>

          {/* Calendar + To-do */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ ...card, padding: "22px 24px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={cardLabel}>Calendar</span>
                <span style={{ fontSize: 13, color: "#7a7a7a" }}>{monthLabel}</span>
              </div>
              <div style={{ display: "flex", marginBottom: 8 }}>
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <span key={d} style={{ flex: 1, textAlign: "center", fontSize: 11, color: "#555", letterSpacing: "0.5px" }}>{d}</span>
                ))}
              </div>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: "flex", marginBottom: 3 }}>
                  {week.map((cell, ci) => (
                    <div key={ci} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: 30 }}>
                      {cell.isToday ? (
                        <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#ededed", color: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 13 }}>
                          {cell.label}
                        </span>
                      ) : (
                        <span style={{ fontSize: 13, color: "#9a9a9a" }}>{cell.label}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div style={{ ...card, padding: "22px 24px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={cardLabel}>To-do</span>
                <span style={{ fontSize: 12, color: "#6a6a6a" }}>{todoSummary}</span>
              </div>
              <form onSubmit={submitTodo} style={{ marginTop: 14 }}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Add a task and press Enter"
                  spellCheck={false}
                  style={{ width: "100%", background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 12px", color: "#ededed", fontSize: 13, fontFamily: "inherit", outline: "none" }}
                />
              </form>
              <div style={{ marginTop: 10 }}>
                {todos.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#555", padding: "12px 0" }}>Nothing yet &mdash; add your first task.</div>
                ) : (
                  todos.map((todo, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 0" }}>
                      <button
                        onClick={() => {
                          const a = todos.slice();
                          a[i] = { text: a[i].text, done: !a[i].done };
                          saveTodos(a);
                        }}
                        style={{ flex: "none", width: 18, height: 18, borderRadius: 5, border: "1.5px solid #444", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
                      >
                        {todo.done && <span style={{ color: "#ededed", fontSize: 12, lineHeight: 1 }}>&#10003;</span>}
                      </button>
                      <span
                        style={{
                          flex: 1,
                          fontSize: 14,
                          color: todo.done ? "#5a5a5a" : "#dcdcdc",
                          textDecoration: todo.done ? "line-through" : "none",
                        }}
                      >
                        {todo.text}
                      </span>
                      <button
                        onClick={() => {
                          const a = todos.slice();
                          a.splice(i, 1);
                          saveTodos(a);
                        }}
                        style={{ flex: "none", background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 17, lineHeight: 1, padding: "0 2px" }}
                      >
                        &times;
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
