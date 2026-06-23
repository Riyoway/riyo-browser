import { useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { AppWindow, Check, PanelTop, Pin, Plus, Settings } from "lucide-react";
import { api } from "./ipc";
import { loadSettings } from "./settings";

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

/** The overflow (⋮) menu, rendered inside its own frameless popup window so it
 *  floats over the tab webview without disturbing the page. Selections are routed
 *  to the owner window via the backend; toggles update optimistically and stay
 *  open; everything else closes the popup. */
export function MenuPopup() {
  const init = loadSettings();
  const [bb, setBb] = useState(init.showBookmarksBar);
  const [aot, setAot] = useState(init.alwaysOnTop);
  const ref = useRef<HTMLDivElement>(null);
  const w = getCurrentWindow();

  useEffect(() => {
    const el = ref.current;
    if (el) w.setSize(new LogicalSize(el.offsetWidth, el.offsetHeight)).catch(() => {});
    // Close on click-away (focus lost), after a short grace so the opening click
    // and the toggle button presses don't dismiss it prematurely.
    let hadFocus = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const un = w.onFocusChanged(({ payload }) => {
      if (payload) {
        hadFocus = true;
        if (t) clearTimeout(t);
      } else if (hadFocus) {
        t = setTimeout(() => w.close().catch(() => {}), 120);
      }
    });
    return () => {
      un.then((f) => f()).catch(() => {});
      if (t) clearTimeout(t);
    };
  }, []);

  const act = (action: string) => {
    api.popupAction(action).catch(() => {});
    w.close().catch(() => {});
  };
  const toggle = (action: string, set: (v: boolean) => void, cur: boolean) => {
    set(!cur);
    api.popupAction(action).catch(() => {});
  };

  return (
    <div ref={ref} className="w-[280px] rounded-large border border-divider bg-content1 p-1.5 text-foreground">
      <Item icon={<Plus size={16} />} label="New tab" shortcut="Ctrl+T" onClick={() => act("newtab")} />
      <Item icon={<AppWindow size={16} />} label="New window" shortcut="Ctrl+N" onClick={() => act("newwindow")} />
      <Sep />
      <Item
        icon={<PanelTop size={16} />}
        label="Show bookmarks bar"
        shortcut="Ctrl+Shift+B"
        checked={bb}
        onClick={() => toggle("bookmarksbar", setBb, bb)}
      />
      <Item
        icon={<Pin size={16} />}
        label="Always on top"
        checked={aot}
        onClick={() => toggle("alwaysontop", setAot, aot)}
      />
      <Sep />
      <Item icon={<Settings size={16} />} label="Settings" shortcut="Ctrl+," onClick={() => act("settings")} />
    </div>
  );
}
