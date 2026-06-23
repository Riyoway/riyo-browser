import { Favicon } from "./Favicon";
import type { Bookmark } from "./bookmarks";

/** A horizontal bar under the toolbar showing saved bookmarks. Left-click opens
 *  in the active tab; middle-click opens in a new tab. */
export function BookmarksBar({
  bookmarks,
  onOpen,
  onOpenNewTab,
}: {
  bookmarks: Bookmark[];
  onOpen: (url: string) => void;
  onOpenNewTab: (url: string) => void;
}) {
  return (
    <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto border-b border-divider bg-content1 px-2 py-1">
      {bookmarks.length === 0 ? (
        <span className="select-none px-2 text-xs text-foreground-400">
          Bookmark a page with the ★ to pin it here
        </span>
      ) : (
        bookmarks.map((b) => (
          <button
            key={b.url}
            type="button"
            title={b.url}
            onClick={() => onOpen(b.url)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onOpenNewTab(b.url);
              }
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground-600 transition-colors hover:bg-content2 hover:text-foreground"
          >
            <Favicon url={b.url} size={15} />
            <span className="max-w-[140px] truncate">{b.title || b.url}</span>
          </button>
        ))
      )}
    </div>
  );
}
