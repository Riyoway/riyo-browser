import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Input } from "@heroui/react";
import { History as HistoryIcon, Search, SquareArrowOutUpRight, Trash2, X } from "lucide-react";
import { PanelShell } from "./PanelShell";
import { Favicon } from "./Favicon";
import { entryKey, type HistoryEntry } from "./history";

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function dayLabel(ts: number): string {
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: "long" });
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function groupByDay(entries: HistoryEntry[]): { label: string; items: HistoryEntry[] }[] {
  const groups: { label: string; items: HistoryEntry[] }[] = [];
  let cur: { label: string; items: HistoryEntry[] } | null = null;
  for (const e of entries) {
    const label = dayLabel(e.ts);
    if (!cur || cur.label !== label) {
      cur = { label, items: [] };
      groups.push(cur);
    }
    cur.items.push(e);
  }
  return groups;
}

function Row({
  e,
  isSelected,
  onToggle,
  onOpen,
  onDelete,
}: {
  e: HistoryEntry;
  isSelected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-medium px-3 py-2 transition-colors hover:bg-content2">
      <Checkbox size="sm" isSelected={isSelected} onValueChange={onToggle} aria-label="Select" />
      <Favicon url={e.url} />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className="w-full truncate text-sm">{e.title || e.url}</span>
        <span className="w-full truncate text-xs text-foreground-500">{e.url}</span>
      </button>
      <span className="shrink-0 text-xs text-foreground-400">{fmtTime(e.ts)}</span>
      <Button
        isIconOnly
        size="sm"
        variant="light"
        aria-label="Delete"
        title="Delete"
        className="opacity-0 transition-opacity group-hover:opacity-100"
        onPress={onDelete}
      >
        <Trash2 size={15} />
      </Button>
    </div>
  );
}

export function HistoryPanel({
  entries,
  onOpen,
  onOpenNewTabs,
  onDelete,
  onClear,
  onClose,
}: {
  entries: HistoryEntry[];
  onOpen: (url: string) => void;
  onOpenNewTabs: (urls: string[]) => void;
  onDelete: (keys: string[]) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => `${e.title} ${e.url}`.toLowerCase().includes(q));
  }, [entries, query]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  // Drop selected keys that no longer exist (after deletion / new visits).
  useEffect(() => {
    setSelected((s) => {
      if (s.size === 0) return s;
      const live = new Set(entries.map(entryKey));
      const next = new Set([...s].filter((k) => live.has(k)));
      return next.size === s.size ? s : next;
    });
  }, [entries]);

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const setGroup = (keys: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)));
      return n;
    });

  const del = (keys: string[]) => {
    onDelete(keys);
    setSelected((s) => {
      const n = new Set(s);
      keys.forEach((k) => n.delete(k));
      return n;
    });
  };

  const openSelected = () => {
    const urls = entries.filter((e) => selected.has(entryKey(e))).map((e) => e.url);
    if (urls.length) onOpenNewTabs(urls);
  };

  const selectedCount = selected.size;

  return (
    <PanelShell
      title="History"
      icon={<HistoryIcon size={20} />}
      onClose={onClose}
      actions={
        entries.length > 0 && (
          <Button size="sm" variant="flat" startContent={<Trash2 size={16} />} onPress={onClear}>
            Clear all
          </Button>
        )
      }
    >
      <div className="mx-auto flex h-full max-w-3xl flex-col px-4 pb-4">
        {/* Search + selection toolbar */}
        <div className="sticky top-0 z-10 space-y-2 bg-background pb-2 pt-3">
          <Input
            size="sm"
            variant="bordered"
            placeholder="Search history"
            value={query}
            onValueChange={setQuery}
            isClearable
            onClear={() => setQuery("")}
            startContent={<Search size={15} className="text-foreground-500" />}
          />
          {selectedCount > 0 && (
            <div className="flex items-center gap-2 rounded-medium bg-content2 px-3 py-1.5">
              <span className="text-sm">{selectedCount} selected</span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="flat" startContent={<SquareArrowOutUpRight size={15} />} onPress={openSelected}>
                  Open
                </Button>
                <Button size="sm" color="danger" variant="flat" startContent={<Trash2 size={15} />} onPress={() => del([...selected])}>
                  Delete
                </Button>
                <Button isIconOnly size="sm" variant="light" aria-label="Clear selection" onPress={() => setSelected(new Set())}>
                  <X size={16} />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-auto">
          {entries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-foreground-500">
              No history yet.
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-foreground-500">
              No matches for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            groups.map((g) => {
              const keys = g.items.map(entryKey);
              const allSelected = keys.every((k) => selected.has(k));
              return (
                <div key={g.label + g.items[0].ts}>
                  <div className="group/day mt-3 flex items-center gap-3 px-3 py-1.5">
                    <Checkbox
                      size="sm"
                      isSelected={allSelected}
                      onValueChange={(v) => setGroup(keys, v)}
                      aria-label={`Select ${g.label}`}
                    />
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground-500">
                      {g.label}
                    </span>
                    <span className="text-xs text-foreground-400">{g.items.length}</span>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      aria-label={`Delete ${g.label}`}
                      title={`Delete ${g.label}`}
                      className="ml-auto opacity-0 transition-opacity group-hover/day:opacity-100"
                      onPress={() => del(keys)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                  {g.items.map((e) => {
                    const key = entryKey(e);
                    return (
                      <Row
                        key={key}
                        e={e}
                        isSelected={selected.has(key)}
                        onToggle={() => toggle(key)}
                        onOpen={() => onOpen(e.url)}
                        onDelete={() => del([key])}
                      />
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </PanelShell>
  );
}
