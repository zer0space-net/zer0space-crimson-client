import { useState } from "react";
import { Outlet, NavLink, useNavigate, Link } from "react-router-dom";
import Wordmark from "./Wordmark";
import Starfield from "./Starfield";
import Chibi from "./Chibi";
import { BRAND } from "../lib/config";
import { useI18n, type Lang } from "../lib/i18n";

export default function Layout() {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const [q, setQ] = useState("");

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
  }

  return (
    <>
      <div className="sky" aria-hidden="true" />
      <Starfield />
      <div className="app-shell">
        <header className="topbar">
          <div className="shell topbar-inner">
            <Wordmark />
            <nav className="nav" aria-label="Hauptnavigation">
              <NavLink to="/" end>
                <span>{t("nav.home")}</span>
              </NavLink>
              <NavLink to="/catalogue">
                <span>{t("nav.catalogue")}</span>
              </NavLink>
              <NavLink to="/settings">
                <span>{t("nav.settings")}</span>
              </NavLink>
            </nav>
            <div className="spacer" />
            <form className="search-inline" role="search" onSubmit={onSearch}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("search.placeholder")}
                aria-label={t("search.placeholder")}
              />
            </form>
            <div className="lang-toggle" role="group" aria-label={t("set.language")}>
              {(["de", "en"] as Lang[]).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </header>

        <main className="content">
          <div className="shell">
            <Outlet />
          </div>
        </main>

        <footer className="site-foot">
          <div className="shell stack gap-6">
            <div>
              <strong>{BRAND.full}</strong> — {t("foot.runsOn")}{" "}
              <span className="credit">Crimson Haven</span>.
            </div>
            <div className="faint">
              {t("foot.engineBackend")}{" "}
              <a href={BRAND.upstreamUrl} target="_blank" rel="noopener noreferrer">
                {BRAND.upstreamName} ↗
              </a>
              {" · "}
              {t("foot.uiBy")} <Link to="/">zer0space</Link>.
            </div>
          </div>
        </footer>
      </div>
      <Chibi />
    </>
  );
}
