import { Button, Chip, Progress } from "@heroui/react";
import {
  Download as DownloadIcon,
  FolderOpen,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCw,
  SquareArrowOutUpRight,
  Trash2,
  X,
} from "lucide-react";
import { PanelShell } from "./PanelShell";
import { downloads, type DownloadItem, type DownloadStatus } from "./ipc";

function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

const STATUS_CHIP: Record<DownloadStatus, { label: string; color: "default" | "primary" | "warning" | "success" | "danger" }> = {
  queued: { label: "Queued", color: "default" },
  active: { label: "Downloading", color: "primary" },
  paused: { label: "Paused", color: "warning" },
  completed: { label: "Completed", color: "success" },
  failed: { label: "Failed", color: "danger" },
  canceled: { label: "Canceled", color: "default" },
};

function Row({ it }: { it: DownloadItem }) {
  const pct = it.total > 0 ? Math.min(100, Math.round((it.received / it.total) * 100)) : 0;
  const chip = STATUS_CHIP[it.status];
  const inProgress = it.status === "active" || it.status === "paused";

  return (
    <li className="flex items-center gap-3 rounded-medium px-3 py-3 transition-colors hover:bg-content2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" title={it.path}>
            {it.filename}
          </span>
          <Chip size="sm" variant="flat" color={chip.color} className="shrink-0">
            {chip.label}
          </Chip>
        </div>

        {inProgress && (
          <Progress
            aria-label="Download progress"
            size="sm"
            className="mt-2"
            color={it.status === "paused" ? "warning" : "primary"}
            value={pct}
            isIndeterminate={it.status === "active" && it.total === 0}
          />
        )}

        <div className="mt-1 truncate text-xs text-foreground-500">
          {it.status === "active" || it.status === "paused"
            ? it.total > 0
              ? `${fmtBytes(it.received)} / ${fmtBytes(it.total)} · ${pct}%`
              : fmtBytes(it.received)
            : it.status === "completed"
              ? fmtBytes(it.total || it.received)
              : it.status === "failed"
                ? it.error || "Failed"
                : it.status === "queued"
                  ? "Waiting in queue"
                  : "Canceled"}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {it.status === "active" && (
          <Button isIconOnly size="sm" variant="light" title="Pause" onPress={() => downloads.pause(it.id)}>
            <Pause size={16} />
          </Button>
        )}
        {it.status === "paused" && (
          <Button isIconOnly size="sm" variant="light" title="Resume" onPress={() => downloads.resume(it.id)}>
            <Play size={16} />
          </Button>
        )}
        {(it.status === "active" || it.status === "paused" || it.status === "queued") && (
          <Button isIconOnly size="sm" variant="light" title="Cancel" onPress={() => downloads.cancel(it.id)}>
            <X size={16} />
          </Button>
        )}
        {(it.status === "failed" || it.status === "canceled") && (
          <Button isIconOnly size="sm" variant="light" title="Retry" onPress={() => downloads.retry(it.id)}>
            <RotateCw size={15} />
          </Button>
        )}
        {it.status === "completed" && (
          <>
            <Button isIconOnly size="sm" variant="light" title="Open" onPress={() => downloads.open(it.id)}>
              <SquareArrowOutUpRight size={15} />
            </Button>
            <Button isIconOnly size="sm" variant="light" title="Show in folder" onPress={() => downloads.openFolder(it.id)}>
              <FolderOpen size={16} />
            </Button>
          </>
        )}
        {(it.status === "completed" || it.status === "failed" || it.status === "canceled") && (
          <Button isIconOnly size="sm" variant="light" title="Remove from list" onPress={() => downloads.remove(it.id)}>
            <Trash2 size={15} />
          </Button>
        )}
      </div>
    </li>
  );
}

export function DownloadsPanel({
  items,
  maxConcurrent,
  onSetMaxConcurrent,
  onClose,
}: {
  items: DownloadItem[];
  maxConcurrent: number;
  onSetMaxConcurrent: (n: number) => void;
  onClose: () => void;
}) {
  const hasFinished = items.some((i) =>
    i.status === "completed" || i.status === "failed" || i.status === "canceled"
  );

  return (
    <PanelShell
      title="Downloads"
      icon={<DownloadIcon size={20} />}
      onClose={onClose}
      actions={
        hasFinished && (
          <Button size="sm" variant="flat" startContent={<Trash2 size={16} />} onPress={() => downloads.clearFinished()}>
            Clear finished
          </Button>
        )
      }
    >
      <div className="mx-auto max-w-3xl px-4 py-4">
        {/* Batch limit — how many downloads run at once. */}
        <div className="mb-4 flex items-center justify-between gap-4 rounded-large border border-divider bg-content1 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Simultaneous downloads</div>
            <div className="text-xs text-foreground-500">
              Queue the rest and run at most this many at once.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              isIconOnly
              size="sm"
              variant="flat"
              aria-label="Fewer"
              isDisabled={maxConcurrent <= 1}
              onPress={() => onSetMaxConcurrent(maxConcurrent - 1)}
            >
              <Minus size={15} />
            </Button>
            <span className="w-6 text-center text-sm tabular-nums">{maxConcurrent}</span>
            <Button
              isIconOnly
              size="sm"
              variant="flat"
              aria-label="More"
              isDisabled={maxConcurrent >= 10}
              onPress={() => onSetMaxConcurrent(maxConcurrent + 1)}
            >
              <Plus size={15} />
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-16 text-foreground-500">
            <DownloadIcon size={28} className="opacity-50" />
            <div className="text-sm">No downloads yet.</div>
            <div className="text-xs">Downloads from pages are queued here.</div>
          </div>
        ) : (
          <ul>
            {items.map((it) => (
              <Row key={it.id} it={it} />
            ))}
          </ul>
        )}
      </div>
    </PanelShell>
  );
}
