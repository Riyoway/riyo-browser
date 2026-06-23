import { Button, Progress } from "@heroui/react";
import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import { downloads, type DownloadItem } from "./ipc";
import { fmtBytes, relTime } from "./format";

const EXT_ICON: Record<string, typeof FileIcon> = {
  zip: FileArchive, rar: FileArchive, "7z": FileArchive, tar: FileArchive, gz: FileArchive,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage, svg: FileImage, bmp: FileImage,
  pdf: FileText, txt: FileText, md: FileText, doc: FileText, docx: FileText, csv: FileText,
  mp4: FileVideo, mov: FileVideo, mkv: FileVideo, webm: FileVideo, avi: FileVideo,
  mp3: FileAudio, wav: FileAudio, flac: FileAudio, m4a: FileAudio,
};

function iconFor(filename: string): typeof FileIcon {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_ICON[ext] ?? FileIcon;
}

function meta(it: DownloadItem): string {
  const pct = it.total > 0 ? Math.round((it.received / it.total) * 100) : 0;
  switch (it.status) {
    case "active":
      return it.total > 0 ? `${fmtBytes(it.received)} / ${fmtBytes(it.total)} · ${pct}%` : fmtBytes(it.received);
    case "paused":
      return `Paused · ${fmtBytes(it.received)}`;
    case "completed":
      return `${fmtBytes(it.total || it.received)} · ${relTime(it.createdAt)}`;
    case "failed":
      return it.error || "Failed";
    case "queued":
      return "Queued";
    default:
      return "Canceled";
  }
}

function Row({ it }: { it: DownloadItem }) {
  const Icon = iconFor(it.filename);
  const inProgress = it.status === "active" || it.status === "paused";
  const pct = it.total > 0 ? Math.round((it.received / it.total) * 100) : 0;
  return (
    <div className="group flex items-center gap-3 rounded-medium px-2 py-2 transition-colors hover:bg-content2">
      <Icon size={22} className="shrink-0 text-foreground-500" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm" title={it.filename}>
          {it.filename}
        </div>
        {inProgress && (
          <Progress
            aria-label="Download progress"
            size="sm"
            className="my-1"
            color={it.status === "paused" ? "warning" : "primary"}
            value={pct}
            isIndeterminate={it.status === "active" && it.total === 0}
          />
        )}
        <div className="truncate text-xs text-foreground-500">{meta(it)}</div>
      </div>
      {it.status === "completed" && (
        <Button
          isIconOnly
          size="sm"
          variant="light"
          className="opacity-0 transition-opacity group-hover:opacity-100"
          title="Open"
          aria-label="Open"
          onPress={() => downloads.open(it.id)}
        >
          <SquareArrowOutUpRight size={15} />
        </Button>
      )}
    </div>
  );
}

/** Small top-right popover with the most recent downloads; "Full download
 *  history" opens the full page. */
export function DownloadsPopover({
  items,
  onOpenFull,
  onClose,
}: {
  items: DownloadItem[];
  onOpenFull: () => void;
  onClose: () => void;
}) {
  const recent = items.slice(0, 5);
  return (
    <div className="anim-pop w-[360px] overflow-hidden rounded-large border border-divider bg-content1 shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold">Recent downloads</span>
        <Button isIconOnly size="sm" variant="light" aria-label="Close" onPress={onClose}>
          <X size={16} />
        </Button>
      </div>

      <div className="max-h-[320px] overflow-auto px-2 pb-2">
        {recent.length === 0 ? (
          <div className="px-2 py-10 text-center text-sm text-foreground-500">No downloads yet.</div>
        ) : (
          recent.map((it) => <Row key={it.id} it={it} />)
        )}
      </div>

      <button
        onClick={onOpenFull}
        className="block w-full border-t border-divider px-4 py-2.5 text-left text-sm font-medium text-primary transition-colors hover:bg-content2"
      >
        Full download history
      </button>
    </div>
  );
}
