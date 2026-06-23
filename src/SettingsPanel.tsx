import type { ReactNode } from "react";
import { Button, Input, Select, SelectItem, Switch } from "@heroui/react";
import { Settings as SettingsIcon, ShieldCheck, Trash2 } from "lucide-react";
import { PanelShell } from "./PanelShell";
import {
  DEFAULT_HOMEPAGE,
  SEARCH_ENGINE_LABEL,
  type SearchEngine,
  type Settings,
} from "./settings";

const ENGINES: SearchEngine[] = ["google", "bing", "duckduckgo"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-500">{title}</h2>
      {children}
    </section>
  );
}

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
  return (
    <PanelShell title="Settings" icon={<SettingsIcon size={20} />} onClose={onClose}>
      <div className="mx-auto max-w-2xl space-y-10 px-6 py-8">
        <Section title="General">
          <Input
            label="Homepage"
            description="Leave blank to use the built-in New Tab page."
            placeholder="New Tab page (blank)"
            value={settings.homepage === DEFAULT_HOMEPAGE ? "" : settings.homepage}
            onValueChange={(v) => onChange({ ...settings, homepage: v.trim() === "" ? DEFAULT_HOMEPAGE : v })}
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
        </Section>

        <Section title="Appearance">
          <Row label="Dark mode">
            <Switch
              isSelected={settings.theme === "dark"}
              onValueChange={(v) => onChange({ ...settings, theme: v ? "dark" : "light" })}
            />
          </Row>
        </Section>

        <Section title="Privacy & data">
          <div className="flex items-start gap-3 rounded-large border border-divider bg-content1 p-4">
            <ShieldCheck size={20} className="mt-0.5 shrink-0 text-success" />
            <div className="text-sm text-foreground-600">
              The engine's background &ldquo;phone-home&rdquo; traffic is disabled: SmartScreen
              URL reporting, component/variations updates, Domain Reliability, crash uploads, and
              the autofill/translate services. Pages you visit still reach their own servers.
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
        </Section>

        <Section title="About">
          <div className="text-sm text-foreground-500">
            tauri-browser · a tabbed browser built on Tauri 2 + WebView2, with a custom title bar
            and a hardened, low-telemetry engine configuration.
          </div>
        </Section>
      </div>
    </PanelShell>
  );
}
