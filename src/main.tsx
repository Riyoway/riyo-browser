import ReactDOM from "react-dom/client";
import { HeroUIProvider } from "@heroui/react";
import { App } from "./App";
import "./styles.css";

// StrictMode is intentionally omitted: its dev-only double-mount tore down the
// one-shot startup work (e.g. opening a "new window" on its target url) and made
// dev diverge from production. The `dark`/`light` class is managed on <html> by
// App (driven by settings) so HeroUI's theme tokens resolve below.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <HeroUIProvider>
    <main className="text-foreground bg-background h-screen w-screen overflow-hidden">
      <App />
    </main>
  </HeroUIProvider>
);
