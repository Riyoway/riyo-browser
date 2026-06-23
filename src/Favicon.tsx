import { useState } from "react";
import { Globe } from "lucide-react";
import { faviconUrls, hostOf } from "./newtabData";

/** Site favicon with a DuckDuckGo → Google → globe fallback chain. */
export function Favicon({ url, size = 16 }: { url: string; size?: number }) {
  const host = hostOf(url);
  const urls = host ? faviconUrls(host) : [];
  const [stage, setStage] = useState(0);
  if (!host || stage >= urls.length) {
    return <Globe size={size - 1} className="shrink-0 text-foreground-500" />;
  }
  return (
    <img
      src={urls[stage]}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-sm"
      onError={() => setStage((s) => s + 1)}
    />
  );
}
