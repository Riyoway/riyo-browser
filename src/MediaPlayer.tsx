import { Button } from "@heroui/react";
import { Music, Pause, Play } from "lucide-react";

export interface MediaState {
  tabId: string;
  has: boolean;
  playing: boolean;
  title: string;
  artist: string;
  art: string;
}

/** Compact toolbar player for whatever media a tab is playing. Click the track
 *  to jump to its tab; play/pause is sent back to that tab. */
export function MediaPlayer({
  media,
  onPlayPause,
  onGoToTab,
  onContextMenu,
}: {
  media: MediaState;
  onPlayPause: () => void;
  onGoToTab: () => void;
  onContextMenu: () => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-full bg-content2 py-1 pl-1 pr-1"
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu();
      }}
    >
      <button
        type="button"
        onClick={onGoToTab}
        title={media.title}
        className="flex min-w-0 items-center gap-2 rounded-full pr-1"
      >
        {media.art ? (
          <img src={media.art} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-content3 text-foreground-500">
            <Music size={14} />
          </span>
        )}
        <span className="min-w-0 max-w-[130px] text-left leading-tight">
          <span className="block truncate text-xs">{media.title || "Playing"}</span>
          <span className="block truncate text-[10px] text-foreground-500">{media.artist}</span>
        </span>
      </button>
      <Button
        isIconOnly
        size="sm"
        radius="full"
        variant="light"
        aria-label={media.playing ? "Pause" : "Play"}
        onPress={onPlayPause}
      >
        {media.playing ? <Pause size={15} className="fill-current" /> : <Play size={15} className="fill-current" />}
      </Button>
    </div>
  );
}
