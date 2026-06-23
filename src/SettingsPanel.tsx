import { useState, type ReactNode } from "react";
import { Button, Input, Select, SelectItem, Switch } from "@heroui/react";
import {
  Info,
  LayoutGrid,
  Lock,
  Palette,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { PanelShell } from "./PanelShell";
import {
  DEFAULT_HOMEPAGE,
  SEARCH_ENGINE_LABEL,
  type SearchEngine,
  type Settings,
  type TempUnit,
} from "./settings";
import { clearLocPerm, getLocPerm, setLocPerm } from "./newtabData";

const ENGINES: SearchEngine[] = ["google", "bing", "duckduckgo"];

type CatKey = "general" | "appearance" | "newtab" | "permissions" | "privacy" | "about";

const CATEGORIES: { key: CatKey; label: string; icon: typeof Info }[] = [
  { key: "general", label: "General", icon: SlidersHorizontal },
  { key: "appearance", label: "Appearance", icon: Palette },
  { key: "newtab", label: "New Tab", icon: LayoutGrid },
  { key: "permissions", label: "Permissions", icon: Lock },
  { key: "privacy", label: "Privacy & data", icon: ShieldCheck },
  { key: "about", label: "About", icon: Info },
];

const LOC_LABEL: Record<string, string> = {
  ask: "Ask each time",
  allow: "Allow",
  block: "Block",
};

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-foreground-500">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  onClearHistory,
  onClearBookmarks,
  onClearAll,
  onClose,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClearHistory: () => void;
  onClearBookmarks: () => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState<CatKey>("general");
  const title = CATEGORIES.find((c) => c.key === active)?.label ?? "";

  // Location permission lives in its own store (consumed by the New Tab page).
  const [loc, setLoc] = useState<string>(() => getLocPerm() ?? "ask");
  const setLocation = (v: string) => {
    setLoc(v);
    if (v === "allow") setLocPerm("allow");
    else if (v === "block") setLocPerm("block");
    else clearLocPerm();
  };

  return (
    <PanelShell title="Settings" icon={<SettingsIcon size={20} />} onClose={onClose}>
      <div className="flex h-full">
        {/* Category sidebar */}
        <nav className="w-52 shrink-0 space-y-0.5 overflow-auto border-r border-divider p-2">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const on = active === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setActive(c.key)}
                className={
                  "flex w-full items-center gap-2.5 rounded-medium px-3 py-2 text-left text-sm transition-colors " +
                  (on
                    ? "bg-content2 font-medium text-foreground"
                    : "text-foreground-600 hover:bg-content2/60 hover:text-foreground")
                }
              >
                <Icon size={16} className="shrink-0" />
                {c.label}
              </button>
            );
          })}
        </nav>

        {/* Active category content */}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-2xl px-8 py-7">
            <h1 className="mb-5 text-lg font-semibold">{title}</h1>

            {active === "general" && (
              <div className="space-y-4">
                <Input
                  label="Homepage"
                  description="Leave blank to use the built-in New Tab page."
                  placeholder="New Tab page (blank)"
                  value={settings.homepage === DEFAULT_HOMEPAGE ? "" : settings.homepage}
                  onValueChange={(v) =>
                    onChange({ ...settings, homepage: v.trim() === "" ? DEFAULT_HOMEPAGE : v })
                  }
                  variant="bordered"
                  endContent={
                    settings.homepage !== DEFAULT_HOMEPAGE && (
                      <Button
                        size="sm"
                        variant="light"
                        onPress={() => onChange({ ...settings, homepage: DEFAULT_HOMEPAGE })}
                      >
                        Reset
                      </Button>
                    )
                  }
                />
                <Select
                  label="Search engine"
                  selectedKeys={[settings.searchEngine]}
                  disallowEmptySelection
                  variant="bordered"
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as SearchEngine | undefined;
                    if (v) onChange({ ...settings, searchEngine: v });
                  }}
                >
                  {ENGINES.map((e) => (
                    <SelectItem key={e}>{SEARCH_ENGINE_LABEL[e]}</SelectItem>
                  ))}
                </Select>
                <Row label="Open new tabs to homepage" description="Otherwise new tabs start blank.">
                  <Switch
                    isSelected={settings.openNewTabToHomepage}
                    onValueChange={(v) => onChange({ ...settings, openNewTabToHomepage: v })}
                  />
                </Row>
              </div>
            )}

            {active === "appearance" && (
              <div className="space-y-4">
                <Row label="Dark mode">
                  <Switch
                    isSelected={settings.theme === "dark"}
                    onValueChange={(v) => onChange({ ...settings, theme: v ? "dark" : "light" })}
                  />
                </Row>
                <Row label="Show bookmarks bar" description="A bar of bookmarks under the toolbar (Ctrl+Shift+B).">
                  <Switch
                    isSelected={settings.showBookmarksBar}
                    onValueChange={(v) => onChange({ ...settings, showBookmarksBar: v })}
                  />
                </Row>
                <Row label="Keep window always on top">
                  <Switch
                    isSelected={settings.alwaysOnTop}
                    onValueChange={(v) => onChange({ ...settings, alwaysOnTop: v })}
                  />
                </Row>
              </div>
            )}

            {active === "newtab" && (
              <div className="space-y-4">
                <Row label="Temperature unit">
                  <Select
                    aria-label="Temperature unit"
                    className="w-44"
                    size="sm"
                    variant="bordered"
                    selectedKeys={[settings.tempUnit]}
                    disallowEmptySelection
                    onSelectionChange={(keys) => {
                      const v = Array.from(keys)[0] as TempUnit | undefined;
                      if (v) onChange({ ...settings, tempUnit: v });
                    }}
                  >
                    <SelectItem key="celsius">Celsius (°C)</SelectItem>
                    <SelectItem key="fahrenheit">Fahrenheit (°F)</SelectItem>
                  </Select>
                </Row>
                <Input
                  label="Weather location"
                  description="Leave blank to use your current location."
                  placeholder="Auto (current location)"
                  value={settings.weatherLocation}
                  onValueChange={(v) => onChange({ ...settings, weatherLocation: v })}
                  variant="bordered"
                />
              </div>
            )}

            {active === "permissions" && (
              <div className="space-y-4">
                <Row
                  label="Location"
                  description="For the New Tab weather (approximate city by IP, never the GPS prompt)."
                >
                  <Select
                    aria-label="Location permission"
                    className="w-44"
                    size="sm"
                    variant="bordered"
                    selectedKeys={[loc]}
                    disallowEmptySelection
                    onSelectionChange={(keys) => {
                      const v = Array.from(keys)[0] as string | undefined;
                      if (v) setLocation(v);
                    }}
                  >
                    {(["ask", "allow", "block"] as const).map((k) => (
                      <SelectItem key={k}>{LOC_LABEL[k]}</SelectItem>
                    ))}
                  </Select>
                </Row>

                <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-foreground-500">
                  New Tab page content
                </div>
                <Row label="Weather" description="Fetch local weather from Open-Meteo.">
                  <Switch
                    isSelected={settings.showWeather}
                    onValueChange={(v) => onChange({ ...settings, showWeather: v })}
                  />
                </Row>
                <Row label="News" description="Fetch headlines and thumbnails from BBC.">
                  <Switch
                    isSelected={settings.showNews}
                    onValueChange={(v) => onChange({ ...settings, showNews: v })}
                  />
                </Row>
                <Row label="Site icons" description="Load favicons from DuckDuckGo.">
                  <Switch
                    isSelected={settings.showSiteIcons}
                    onValueChange={(v) => onChange({ ...settings, showSiteIcons: v })}
                  />
                </Row>

                <div className="rounded-large border border-divider bg-content1 p-3 text-xs text-foreground-500">
                  Permission prompts from the websites you visit (camera, microphone, notifications)
                  are still shown by the engine itself.
                </div>
              </div>
            )}

            {active === "privacy" && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-large border border-divider bg-content1 p-4">
                  <ShieldCheck size={20} className="mt-0.5 shrink-0 text-success" />
                  <div className="text-sm text-foreground-600">
                    The engine's background &ldquo;phone-home&rdquo; traffic is disabled: SmartScreen
                    URL reporting, component/variations updates, Domain Reliability, crash uploads,
                    and the autofill/translate services. Pages you visit still reach their own
                    servers. The New Tab page also fetches weather (Open-Meteo, with your
                    consented approximate city via ipapi.co — IP-based, never the GPS prompt), news
                    (BBC), and site icons (DuckDuckGo) from those third parties.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="flat" startContent={<Trash2 size={16} />} onPress={onClearHistory}>
                    Clear history
                  </Button>
                  <Button variant="flat" startContent={<Trash2 size={16} />} onPress={onClearBookmarks}>
                    Clear bookmarks
                  </Button>
                  <Button color="danger" variant="flat" startContent={<Trash2 size={16} />} onPress={onClearAll}>
                    Clear all local data
                  </Button>
                </div>
              </div>
            )}

            {active === "about" && (
              <div className="space-y-3 text-sm text-foreground-600">
                <p>
                  <span className="font-medium text-foreground">riyo-browser</span> — a tabbed
                  browser built on Tauri 2 + WebView2, with a custom title bar, a HeroUI interface,
                  and a hardened, low-telemetry engine configuration.
                </p>
                <p className="text-foreground-500">
                  Tabs, bookmarks, history, downloads, custom New Tab page, and multi-window support.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PanelShell>
  );
}
