import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HeroUIProvider } from "@heroui/react";
import { App } from "./App";
import { MenuPopup } from "./MenuPopup";
import "./styles.css";

// StrictMode is intentionally omitted: its dev-only double-mount tore down the
// one-shot startup work (e.g. opening a "new window" on its target url) and made
// dev diverge from production. The `dark`/`light` class is managed on <html> by
// App (driven by settings) so HeroUI's theme tokens resolve below.
const root = ReactDOM.createRoot(document.getElementById("root")!);

// A few labelled windows are popups hosting a single piece of chrome (so it can
// float over the native tab webview) rather than the whole browser.
const label = (() => {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
})();

if (label === "menu-popup") {
  document.documentElement.classList.add("dark");
  root.render(
    <HeroUIProvider>
      <MenuPopup />
    </HeroUIProvider>
  );
} else {
  root.render(
    <HeroUIProvider>
      <main className="text-foreground bg-background h-screen w-screen overflow-hidden">
        <App />
      </main>
    </HeroUIProvider>
  );
}
