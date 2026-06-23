import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from "react";
import { SEARCH_ENGINE_LABEL, type SearchEngine } from "./settings";

// The built-in New Tab / blank page. Rendered as a React overlay in the host
// webview (the native tab webview is parked while it's shown). Implemented from
// the "Blank Page" design: clock, greeting, search, shortcuts, weather, news,
// calendar, and a persisted to-do list.

interface NewTabPageProps {
  searchEngine: SearchEngine;
  /** Open raw address-bar input in the active tab (URL or search query). */
  onNavigate: (input: string) => void;
}

interface Todo {
  text: string;
  done: boolean;
}

const SHORTCUTS = [
  { name: "GitHub", url: "https://github.com", mono: "G" },
  { name: "YouTube", url: "https://youtube.com", mono: "Y" },
  { name: "Gmail", url: "https://mail.google.com", mono: "M" },
  { name: "Maps", url: "https://maps.google.com", mono: "A" },
  { name: "Reddit", url: "https://reddit.com", mono: "R" },
  { name: "Notion", url: "https://notion.so", mono: "N" },
  { name: "Drive", url: "https://drive.google.com", mono: "D" },
  { name: "Wikipedia", url: "https://wikipedia.org", mono: "W" },
];

type Cond = "sun" | "partly" | "cloud" | "rain" | "snow";
const WEATHER: { day: string; cond: Cond; hi: number; lo: number }[] = [
  { day: "Today", cond: "sun", hi: 72, lo: 58 },
  { day: "Tue", cond: "partly", hi: 70, lo: 57 },
  { day: "Wed", cond: "cloud", hi: 66, lo: 55 },
  { day: "Thu", cond: "rain", hi: 61, lo: 53 },
  { day: "Fri", cond: "rain", hi: 63, lo: 52 },
  { day: "Sat", cond: "partly", hi: 68, lo: 54 },
  { day: "Sun", cond: "sun", hi: 74, lo: 59 },
];

const CATS = ["Top", "Tech", "Business", "Science", "Sports", "World"] as const;
type Cat = (typeof CATS)[number];

const NEWS: Record<Cat, { title: string; source: string; time: string }[]> = {
  Top: [
    { title: "Global markets steady as central banks signal a pause on rate moves", source: "Wire Report", time: "2h" },
    { title: "Coastal cities unveil joint plan to upgrade aging infrastructure", source: "Metro Desk", time: "3h" },
    { title: "New study links short daily walks to long-term heart health", source: "Health Daily", time: "5h" },
    { title: "Tech firms pledge billions toward domestic chip production", source: "Business Wire", time: "6h" },
    { title: "Annual film festival announces this year's award lineup", source: "Culture", time: "8h" },
  ],
  Tech: [
    { title: "Open-source AI models close the gap with proprietary leaders", source: "Tech Review", time: "1h" },
    { title: "Next-gen laptops promise all-day battery on new silicon", source: "Gadget Desk", time: "3h" },
    { title: "Developers rally around faster, lighter web frameworks", source: "Dev Weekly", time: "4h" },
    { title: "Wearables shift focus from steps to sleep and recovery", source: "Future", time: "7h" },
    { title: "Cloud providers cut prices in the race for AI workloads", source: "Enterprise", time: "9h" },
  ],
  Business: [
    { title: "Quarterly earnings beat expectations across the retail sector", source: "Markets", time: "1h" },
    { title: "Startup funding rebounds after a slow start to the year", source: "Ventures", time: "2h" },
    { title: "Supply chains stabilize as global shipping costs ease", source: "Trade", time: "4h" },
    { title: "Remote-first companies report higher retention rates", source: "Workplace", time: "6h" },
    { title: "Energy prices dip ahead of summer demand", source: "Commodities", time: "8h" },
  ],
  Science: [
    { title: "Telescope captures the sharpest image yet of a distant galaxy", source: "Space", time: "2h" },
    { title: "Researchers map a new pathway in cellular repair", source: "Journal", time: "3h" },
    { title: "Coral restoration project shows early signs of success", source: "Environment", time: "5h" },
    { title: "Lab-grown materials could cut construction emissions", source: "Materials", time: "7h" },
    { title: "Antarctic survey updates models of sea-level rise", source: "Climate", time: "10h" },
  ],
  Sports: [
    { title: "Underdogs clinch a playoff spot in a final-second thriller", source: "Sports Desk", time: "1h" },
    { title: "Veteran striker signs record extension with hometown club", source: "Transfers", time: "3h" },
    { title: "Marathon world record falls at the morning event", source: "Athletics", time: "4h" },
    { title: "League announces expansion teams for next season", source: "Pro", time: "6h" },
    { title: "Rookie sensation named player of the month", source: "Highlights", time: "9h" },
  ],
  World: [
    { title: "Diplomats reach a framework on cross-border trade rules", source: "Global", time: "1h" },
    { title: "Historic old town reopens after a multi-year restoration", source: "Travel", time: "3h" },
    { title: "Election turnout hits a record high in regional vote", source: "Politics", time: "5h" },
    { title: "Aid groups expand relief efforts after seasonal floods", source: "Humanitarian", time: "7h" },
    { title: "Cultural exchange program returns after a long pause", source: "Society", time: "9h" },
  ],
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function WeatherIcon({ cond }: { cond: Cond }) {
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
  const cloud = "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z";
  if (cond === "sun")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
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
  if (cond === "partly")
    return (
      <svg {...p}>
        <circle cx="8" cy="7" r="3" />
        <path d="M8 1.5v1M2.6 4.6l.7.7M13.4 4.6l-.7.7M1.5 10h1" />
        <path d="M19 13h-1.05A6 6 0 1 0 9 19h10a3.5 3.5 0 0 0 0-7z" />
      </svg>
    );
  return (
    <svg {...p}>
      <path d={cloud} />
    </svg>
  );
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
    weeks.push(
      cells.slice(i, i + 7).map((d) => ({ label: d ? String(d) : "", isToday: d === today }))
    );
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

export function NewTabPage({ searchEngine, onNavigate }: NewTabPageProps) {
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Cat>("Top");
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

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
  const news = NEWS[category];
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

        {/* Shortcuts */}
        <div style={{ width: "100%", maxWidth: 1120, marginTop: 48, display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center" }}>
          {SHORTCUTS.map((s) => (
            <button
              key={s.name}
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
                  color: "#d4d4d4",
                  fontSize: 20,
                  fontWeight: 500,
                }}
              >
                {s.mono}
              </div>
              <span style={{ fontSize: 12, color: "#8a8a8a", maxWidth: 82, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            </button>
          ))}
        </div>

        {/* Weather */}
        <div style={{ ...card, width: "100%", maxWidth: 1120, marginTop: 40, padding: "22px 26px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={cardLabel}>Weather</span>
            <span style={{ fontSize: 13, color: "#7a7a7a" }}>San Francisco</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 18 }}>
            {WEATHER.map((d) => (
              <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 11, padding: "6px 0" }}>
                <span style={{ fontSize: 11, color: "#8a8a8a", textTransform: "uppercase", letterSpacing: "0.6px" }}>{d.day}</span>
                <div style={{ height: 28, display: "flex", alignItems: "center" }}>
                  <WeatherIcon cond={d.cond} />
                </div>
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: "#ededed" }}>{d.hi}&deg;</span>
                  <span style={{ color: "#5e5e5e", marginLeft: 2 }}>{d.lo}&deg;</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* News + Calendar + To-do */}
        <div style={{ width: "100%", maxWidth: 1120, marginTop: 24, display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 24, alignItems: "start" }}>
          {/* News */}
          <div style={{ ...card, padding: "24px 26px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={cardLabel}>News</span>
            </div>
            <div style={{ display: "flex", gap: 20, borderBottom: "1px solid rgba(255,255,255,0.07)", paddingBottom: 2, overflowX: "auto" }}>
              {CATS.map((c) => {
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
              {news.map((n) => (
                <button
                  key={n.title}
                  className="ntp-news"
                  onClick={() => onNavigate(n.title)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "15px 0", borderBottom: "1px solid rgba(255,255,255,0.045)" }}
                >
                  <div style={{ fontSize: 14, color: "#e4e4e4", lineHeight: 1.45 }}>{n.title}</div>
                  <div style={{ fontSize: 12, color: "#6a6a6a", marginTop: 6 }}>
                    {n.source} &middot; {n.time}
                  </div>
                </button>
              ))}
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
