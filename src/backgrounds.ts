// Selectable backgrounds for the New Tab (home) page. Bundled images are
// imported so Vite fingerprints and ships them; `url` is undefined for the plain
// dark default. Add more entries here to grow the picker.
import paperWavy from "./assets/backgrounds/paper-wavy.jpg";

export interface HomeBackground {
  id: string;
  label: string;
  /** Image URL, or undefined for the solid dark default. */
  url?: string;
}

export const DEFAULT_BACKGROUND = "default";

export const BACKGROUNDS: HomeBackground[] = [
  { id: "default", label: "Dark" },
  { id: "paper-wavy", label: "Paper waves", url: paperWavy },
];

export function backgroundUrl(id: string): string | undefined {
  return BACKGROUNDS.find((b) => b.id === id)?.url;
}
