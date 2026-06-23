import { Button } from "@heroui/react";
import { Bookmark as BookmarkIcon, Globe, X } from "lucide-react";
import { PanelShell } from "./PanelShell";
import type { Bookmark } from "./bookmarks";

export function BookmarksPanel({
  bookmarks,
  onOpen,
  onRemove,
  onClose,
}: {
  bookmarks: Bookmark[];
  onOpen: (url: string) => void;
  onRemove: (url: string) => void;
  onClose: () => void;
}) {
  return (
    <PanelShell title="Bookmarks" icon={<BookmarkIcon size={20} />} onClose={onClose}>
      {bookmarks.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-foreground-500">
          <BookmarkIcon size={28} className="opacity-50" />
          <div className="text-sm">No bookmarks yet.</div>
          <div className="text-xs">Click the star in the address bar to save a page.</div>
        </div>
      ) : (
        <ul className="mx-auto max-w-3xl px-3 py-3">
          {bookmarks.map((b, i) => (
            <li key={`${b.url}-${i}`} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => onOpen(b.url)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-medium px-3 py-2 text-left transition-colors hover:bg-content2"
              >
                <Globe size={16} className="shrink-0 text-foreground-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{b.title || b.url}</span>
                  <span className="block truncate text-xs text-foreground-500">{b.url}</span>
                </span>
              </button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                aria-label="Remove bookmark"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onPress={() => onRemove(b.url)}
              >
                <X size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
