import { Button } from "@heroui/react";
import { MapPin, X } from "lucide-react";

/** Our own location-consent dialog (styled to match the app) shown instead of
 *  the engine's native geolocation prompt — we use IP-based location, not the
 *  browser geolocation API, so the native prompt never appears. */
export function LocationPermission({
  onDecide,
}: {
  onDecide: (decision: "allow" | "session" | "block") => void;
}) {
  return (
    <div className="anim-pop absolute left-4 top-4 z-50 w-[340px] rounded-large border border-divider bg-content1 p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-content2 text-primary">
          <MapPin size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Use your approximate location?</div>
          <div className="mt-1 text-xs text-foreground-500">
            riyo-browser can show local weather using your city (looked up by IP — not GPS). You can
            also set a location in Settings.
          </div>
        </div>
        <Button isIconOnly size="sm" variant="light" aria-label="Dismiss" onPress={() => onDecide("block")}>
          <X size={16} />
        </Button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="flat" onPress={() => onDecide("block")}>
          Block
        </Button>
        <Button size="sm" variant="flat" onPress={() => onDecide("session")}>
          Just this time
        </Button>
        <Button size="sm" color="primary" onPress={() => onDecide("allow")}>
          Allow
        </Button>
      </div>
    </div>
  );
}
