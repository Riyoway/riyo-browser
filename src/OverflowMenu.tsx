import type { ReactNode } from "react";
import { AppWindow, Check, PanelTop, Pin, Plus, Settings } from "lucide-react";

function Item({
  icon,
  label,
  shortcut,
  checked,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  checked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-medium px-3 py-2 text-sm text-foreground-700 transition-colors hover:bg-content2 hover:text-foreground"
    >
      <span className="flex w-4 shrink-0 justify-center text-foreground-500">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-xs text-foreground-400">{shortcut}</span>}
      {checked !== undefined &&
        (checked ? <Check size={15} className="text-primary" /> : <span className="w-[15px]" />)}
    </button>
  );
}

function Sep() {
  return <div className="my-1 h-px bg-divider" />;
}

/** Chrome-style overflow (⋮) menu collecting the less-frequent toolbar actions. */
export function OverflowMenu({
  showBookmarksBar,
  alwaysOnTop,
  onClose,
  onNewTab,
  onNewWindow,
  onSettings,
  onToggleBookmarksBar,
  onToggleAlwaysOnTop,
}: {
  showBookmarksBar: boolean;
  alwaysOnTop: boolean;
  onClose: () => void;
  onNewTab: () => void;
  onNewWindow: () => void;
  onSettings: () => void;
  onToggleBookmarksBar: () => void;
  onToggleAlwaysOnTop: () => void;
}) {
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div className="anim-pop w-[260px] overflow-hidden rounded-large border border-divider bg-content1 p-1.5 shadow-2xl">
      <Item icon={<Plus size={16} />} label="New tab" shortcut="Ctrl+T" onClick={run(onNewTab)} />
      <Item icon={<AppWindow size={16} />} label="New window" shortcut="Ctrl+N" onClick={run(onNewWindow)} />
      <Sep />
      <Item
        icon={<PanelTop size={16} />}
        label="Show bookmarks bar"
        shortcut="Ctrl+Shift+B"
        checked={showBookmarksBar}
        onClick={onToggleBookmarksBar}
      />
      <Item
        icon={<Pin size={16} />}
        label="Always on top"
        checked={alwaysOnTop}
        onClick={onToggleAlwaysOnTop}
      />
      <Sep />
      <Item icon={<Settings size={16} />} label="Settings" shortcut="Ctrl+," onClick={run(onSettings)} />
    </div>
  );
}
