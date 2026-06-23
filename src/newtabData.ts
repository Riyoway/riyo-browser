// Live data for the New Tab page: weather (Open-Meteo + geolocation), news (BBC
// RSS via the Rust proxy, since RSS isn't CORS-enabled), and frequently-used
// sites (derived from history) with favicons. All results are cached in
// localStorage with a TTL so the page paints instantly and refreshes quietly.

import { api } from "./ipc";
import { loadHistory } from "./history";
import type { TempUnit } from "./settings";

// ---------- weather ----------

export type IconBucket = "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "thunder";

// WMO weather codes -> icon bucket (verified against Open-Meteo).
const WMO: Record<number, IconBucket> = {
  0: "sun", 1: "sun", 2: "partly", 3: "cloud",
  45: "fog", 48: "fog",
  51: "rain", 53: "rain", 55: "rain", 56: "rain", 57: "rain",
  61: "rain", 63: "rain", 65: "rain", 66: "rain", 67: "rain",
  71: "snow", 73: "snow", 75: "snow", 77: "snow",
  80: "rain", 81: "rain", 82: "rain", 85: "snow", 86: "snow",
  95: "thunder", 96: "thunder", 99: "thunder",
};
export const iconFor = (code: number): IconBucket => WMO[code] ?? "cloud";

export interface WeatherDay {
  day: string;
  icon: IconBucket;
  hi: number;
  lo: number;
}
export interface Weather {
  locationLabel: string;
  currentTemp: number;
  unitSymbol: "°C" | "°F";
  days: WeatherDay[];
}

interface Geo {
  lat: number;
  lon: number;
  label: string;
}

const WEATHER_KEY = "blankpage.weather";
const WEATHER_TTL = 30 * 60 * 1000;
const GEO_KEY = "blankpage.geo";
const GEO_TTL = 6 * 60 * 60 * 1000;

const join2 = (parts: (string | undefined | null)[]) =>
  parts.filter((p): p is string => !!p && p.trim() !== "").slice(0, 2).join(", ");

async function geoFromQuery(q: string): Promise<Geo | null> {
  try {
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`
    );
    const d = await r.json();
    const g = d?.results?.[0];
    if (!g) return null;
    return { lat: g.latitude, lon: g.longitude, label: join2([g.name, g.admin1, g.country_code]) || q };
  } catch {
    return null;
  }
}

function geoFromBrowser(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { timeout: 6000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
    );
    const d = await r.json();
    return join2([d.city || d.locality, d.principalSubdivision]) || "Current location";
  } catch {
    return "Current location";
  }
}

async function geoFromIp(): Promise<Geo | null> {
  try {
    const r = await fetch("https://ipapi.co/json/");
    if (r.ok) {
      const d = await r.json();
      if (typeof d.latitude === "number")
        return { lat: d.latitude, lon: d.longitude, label: join2([d.city, d.region]) || "Current location" };
    }
  } catch {
    /* fall through */
  }
  try {
    const r = await fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en");
    const d = await r.json();
    if (typeof d.latitude === "number")
      return {
        lat: d.latitude,
        lon: d.longitude,
        label: join2([d.city || d.locality, d.principalSubdivision]) || "Current location",
      };
  } catch {
    /* fall through */
  }
  return null;
}

// `resolved` distinguishes a real lookup from the hardcoded default so the
// caller doesn't cache (and stick on) the default after a transient failure.
async function resolveLocation(manual: string): Promise<{ geo: Geo; resolved: boolean }> {
  const q = manual.trim();
  if (q) {
    const g = await geoFromQuery(q);
    if (g) return { geo: g, resolved: true };
  }
  const b = await geoFromBrowser();
  if (b) return { geo: { lat: b.lat, lon: b.lon, label: await reverseGeocode(b.lat, b.lon) }, resolved: true };
  const ip = await geoFromIp();
  if (ip) return { geo: ip, resolved: true };
  return { geo: { lat: 37.7749, lon: -122.4194, label: "San Francisco" }, resolved: false };
}

// The cache is keyed by location + unit so a settings change isn't shown stale
// data from the previous location/unit, and a fresh entry lets the caller skip
// the network entirely.
export function cachedWeather(loc: string, unit: TempUnit): Weather | null {
  try {
    const c = JSON.parse(localStorage.getItem(WEATHER_KEY) || "null");
    if (c && c.loc === loc && c.unit === unit && Date.now() - c.ts < WEATHER_TTL) return c.data as Weather;
  } catch {
    /* ignore */
  }
  return null;
}

export async function fetchWeather(manualLoc: string, unit: TempUnit): Promise<Weather> {
  let geo: Geo | null = null;
  try {
    const gc = JSON.parse(localStorage.getItem(GEO_KEY) || "null");
    if (gc && Date.now() - gc.ts < GEO_TTL && gc.q === manualLoc) geo = gc.geo;
  } catch {
    /* ignore */
  }
  if (!geo) {
    const res = await resolveLocation(manualLoc);
    geo = res.geo;
    // Only cache a genuine lookup — never the hardcoded default, or it would
    // pin the weather to that default for the whole TTL after a transient miss.
    if (res.resolved) {
      try {
        localStorage.setItem(GEO_KEY, JSON.stringify({ ts: Date.now(), q: manualLoc, geo }));
      } catch {
        /* ignore */
      }
    }
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
    `&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=${unit}&timezone=auto&forecast_days=7`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("weather " + r.status);
  const d = await r.json();
  if (!d?.current || !d?.daily?.time?.length) throw new Error("weather: empty forecast");
  const days: WeatherDay[] = d.daily.time.map((t: string, i: number) => ({
    day: i === 0 ? "Today" : new Date(t + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" }),
    icon: iconFor(d.daily.weather_code[i]),
    hi: Math.round(d.daily.temperature_2m_max[i]),
    lo: Math.round(d.daily.temperature_2m_min[i]),
  }));
  const weather: Weather = {
    locationLabel: geo.label,
    currentTemp: Math.round(d.current.temperature_2m),
    unitSymbol: unit === "fahrenheit" ? "°F" : "°C",
    days,
  };
  try {
    localStorage.setItem(WEATHER_KEY, JSON.stringify({ ts: Date.now(), loc: manualLoc, unit, data: weather }));
  } catch {
    /* ignore */
  }
  return weather;
}

// ---------- news ----------

export interface NewsItem {
  title: string;
  url: string;
  image: string;
  source: string;
  time: string;
}

export const NEWS_CATEGORIES = ["Top", "Tech", "Business", "Science", "Sports", "World"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

const NEWS_FEEDS: Record<NewsCategory, string> = {
  Top: "https://feeds.bbci.co.uk/news/rss.xml",
  Tech: "https://feeds.bbci.co.uk/news/technology/rss.xml",
  Business: "https://feeds.bbci.co.uk/news/business/rss.xml",
  Science: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
  Sports: "https://feeds.bbci.co.uk/sport/rss.xml",
  World: "https://feeds.bbci.co.uk/news/world/rss.xml",
};
const NEWS_TTL = 15 * 60 * 1000;

function relTime(pub: string): string {
  const t = Date.parse(pub);
  if (isNaN(t)) return "";
  const diff = Date.now() - t;
  if (diff < 3600000) return Math.max(1, Math.floor(diff / 60000)) + "m";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h";
  return Math.floor(diff / 86400000) + "d";
}

function cleanLink(link: string): string {
  try {
    const u = new URL(link);
    [...u.searchParams.keys()].forEach((k) => {
      if (k.startsWith("at_")) u.searchParams.delete(k);
    });
    return u.toString();
  } catch {
    return link;
  }
}

export function cachedNews(cat: NewsCategory): NewsItem[] | null {
  try {
    const c = JSON.parse(localStorage.getItem("blankpage.news." + cat) || "null");
    if (c && Date.now() - c.ts < NEWS_TTL) return c.items as NewsItem[];
  } catch {
    /* ignore */
  }
  return null;
}

export async function fetchNews(cat: NewsCategory): Promise<NewsItem[]> {
  const xml = await api.httpGetText(NEWS_FEEDS[cat]);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("news parse error");
  const source = cat === "Sports" ? "BBC Sport" : "BBC News";
  const items: NewsItem[] = Array.from(doc.querySelectorAll("item"))
    .slice(0, 8)
    .map((it) => {
      const title = it.querySelector("title")?.textContent?.trim() || "";
      const link = cleanLink(it.querySelector("link")?.textContent?.trim() || "");
      const thumb =
        it.getElementsByTagName("media:thumbnail")[0] || it.getElementsByTagName("media:content")[0];
      const image = thumb?.getAttribute("url") || "";
      const time = relTime(it.querySelector("pubDate")?.textContent || "");
      return { title, url: link, image, source, time };
    })
    .filter((n) => n.title && n.url);
  try {
    localStorage.setItem("blankpage.news." + cat, JSON.stringify({ ts: Date.now(), items }));
  } catch {
    /* ignore */
  }
  return items;
}

// ---------- frequently-used sites + favicons ----------

export interface Site {
  name: string;
  url: string;
  host: string;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function originOf(url: string): string {
  try {
    return new URL(url).origin + "/";
  } catch {
    return url;
  }
}
function nameFromHost(host: string): string {
  const main = host.split(".")[0] || host;
  return main.charAt(0).toUpperCase() + main.slice(1);
}

export function faviconUrls(host: string): string[] {
  return [`https://icons.duckduckgo.com/ip3/${host}.ico`, `https://www.google.com/s2/favicons?domain=${host}&sz=64`];
}

export function monogramColor(host: string): string {
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 42%)`;
}

// Curated defaults (used to pad the grid until history has enough sites).
const DEFAULT_SITES: Site[] = [
  { name: "GitHub", url: "https://github.com", host: "github.com" },
  { name: "YouTube", url: "https://youtube.com", host: "youtube.com" },
  { name: "Gmail", url: "https://mail.google.com", host: "mail.google.com" },
  { name: "Maps", url: "https://maps.google.com", host: "maps.google.com" },
  { name: "Reddit", url: "https://reddit.com", host: "reddit.com" },
  { name: "Notion", url: "https://notion.so", host: "notion.so" },
  { name: "Drive", url: "https://drive.google.com", host: "drive.google.com" },
  { name: "Wikipedia", url: "https://wikipedia.org", host: "wikipedia.org" },
];

/** Most-visited sites from history, padded with curated defaults to `max`. */
export function topSites(max = 8): Site[] {
  const counts = new Map<string, { count: number; url: string }>();
  for (const h of loadHistory()) {
    const host = hostOf(h.url);
    if (!host) continue;
    const e = counts.get(host);
    if (e) e.count++;
    else counts.set(host, { count: 1, url: originOf(h.url) });
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([host, v]) => ({ name: nameFromHost(host), url: v.url, host }));

  const seen = new Set(ranked.map((s) => s.host));
  for (const d of DEFAULT_SITES) {
    if (ranked.length >= max) break;
    if (!seen.has(d.host)) {
      ranked.push(d);
      seen.add(d.host);
    }
  }
  return ranked.slice(0, max);
}
