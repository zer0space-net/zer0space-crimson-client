import { useState } from "react";
import { Outlet, NavLink, useNavigate, Link } from "react-router-dom";
import Wordmark from "./Wordmark";
import Starfield from "./Starfield";
import Chibi from "./Chibi";
import { BRAND } from "../lib/config";

export default function Layout() {
  const navigate = useNavigate();
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
                <span>Start</span>
              </NavLink>
              <NavLink to="/catalogue">
                <span>Katalog</span>
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
                placeholder="Suchen …"
                aria-label="Titel suchen"
              />
            </form>
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
              <strong>{BRAND.full}</strong> — läuft auf dem{" "}
              <span className="credit">Crimson Haven</span> Backend.
            </div>
            <div className="faint">
              Streaming-Engine &amp; Backend:{" "}
              <a href={BRAND.upstreamUrl} target="_blank" rel="noopener noreferrer">
                {BRAND.upstreamName} ↗
              </a>
              {" · "}
              Oberfläche &amp; Betrieb: zer0space. Gehostet hinter{" "}
              <Link to="/">zer0space</Link>.
            </div>
          </div>
        </footer>
      </div>
      <Chibi />
    </>
  );
}
