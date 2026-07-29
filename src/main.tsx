import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ROUTER_BASENAME } from "./lib/config";
import { I18nProvider } from "./lib/i18n";
import { initAccent } from "./lib/theme";
import App from "./App";
import "./styles/tokens.css";
import "./styles/app.css";

// Apply the stored accent before first render so there's no colour flash.
initAccent();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);
