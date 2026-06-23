import { Button } from "@heroui/react";
import { Globe, History as HistoryIcon, Trash2 } from "lucide-react";
import { PanelShell } from "./PanelShell";
import type { HistoryEntry } from "./history";

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

export function HistoryPanel({
  entries,
  onOpen,
  onClear,
  onClose,
}: {
  entries: HistoryEntry[];
  onOpen: (url: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <PanelShell
      title="History"
      icon={<HistoryIcon size={20} />}
      onClose={onClose}
      actions={
        entries.length > 0 && (
          <Button size="sm" variant="flat" startContent={<Trash2 size={16} />} onPress={onClear}>
            Clear
          </Button>
        )
      }
    >
      {entries.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-foreground-500">
          No history yet.
        </div>
      ) : (
        <ul className="mx-auto max-w-3xl px-3 py-3">
          {entries.map((e, i) => (
            <li key={`${e.ts}-${i}`}>
              <button
                type="button"
                onClick={() => onOpen(e.url)}
                className="flex w-full items-center gap-3 rounded-medium px-3 py-2 text-left transition-colors hover:bg-content2"
              >
                <Globe size={16} className="shrink-0 text-foreground-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{e.title || e.url}</span>
                  <span className="block truncate text-xs text-foreground-500">{e.url}</span>
                </span>
                <span className="shrink-0 text-xs text-foreground-400">{fmtTime(e.ts)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
