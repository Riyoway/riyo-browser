import React from "react";
import ReactDOM from "react-dom/client";
import { HeroUIProvider } from "@heroui/react";
import { App } from "./App";
import "./styles.css";

// The `dark`/`light` class is managed on <html> by App (driven by settings), so
// HeroUI's theme tokens resolve correctly for everything below.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HeroUIProvider>
      <main className="text-foreground bg-background h-screen w-screen overflow-hidden">
        <App />
      </main>
    </HeroUIProvider>
  </React.StrictMode>
);
