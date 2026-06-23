// Selectable backgrounds for the New Tab (home) page. Bundled images are
// imported so Vite fingerprints and ships them; `url` is undefined for the plain
// dark default. Add more entries here to grow the picker.
import paperWavy from "./assets/backgrounds/paper-wavy.jpg";

export interface HomeBackground {
  id: string;
  label: string;
  /** Image URL, or undefined for a solid color. */
  url?: string;
  /** Solid background color when there's no image (defaults to dark). */
  color?: string;
  /** Light backgrounds switch the on-background text to a dark tone. */
  light?: boolean;
}

export const DEFAULT_BACKGROUND = "default";

export const BACKGROUNDS: HomeBackground[] = [
  { id: "default", label: "Dark" },
  { id: "white", label: "White", color: "#ffffff", light: true },
  { id: "paper-wavy", label: "Paper waves", url: paperWavy },
];

export function backgroundInfo(id: string): HomeBackground | undefined {
  return BACKGROUNDS.find((b) => b.id === id);
}

export function backgroundUrl(id: string): string | undefined {
  return backgroundInfo(id)?.url;
}
