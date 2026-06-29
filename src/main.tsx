import App from "@/App";
import { registerServiceWorker } from "@/pwa/registerSW";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
