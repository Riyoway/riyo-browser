import type { ReactNode } from "react";
import { Button } from "@heroui/react";
import { X } from "lucide-react";

/** Full-bleed overlay used by the settings / history / bookmarks "pages". It
 *  covers the content area; the caller parks the tab webview while it's open so
 *  this DOM isn't occluded by the native child webview. */
export function PanelShell({
  title,
  icon,
  actions,
  onClose,
  children,
}: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="anim-fade-up absolute inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center gap-2.5 border-b border-divider px-5 py-3">
        {icon}
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button isIconOnly variant="light" size="sm" aria-label="Close" onPress={onClose}>
            <X size={18} />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
