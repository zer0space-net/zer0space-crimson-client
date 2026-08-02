import { useState } from "react";
import { Outlet, NavLink, useNavigate, Link } from "react-router-dom";
import Wordmark from "./Wordmark";
import Starfield from "./Starfield";
import Chibi from "./Chibi";
import { BRAND } from "../lib/config";
import { useI18n, type Lang } from "../lib/i18n";

// The five destinations, in one list so the topbar links and the phone tab bar
// can never drift apart. A drawer was the other option and it is the wrong one
// here: this is a streaming app you browse one-handed, and a tab bar keeps every
// destination one thumb-reach from the bottom of the screen instead of two taps
// behind a hamburger.
const DESTINATIONS = [
  {
    to: "/",
    end: true,
    key: "nav.home",
    icon: <path d="M3.6 10.4 12 3.7l8.4 6.7V20a1 1 0 0 1-1 1h-4.6v-6H9.2v6H4.6a1 1 0 0 1-1-1Z" />,
  },
  {
    to: "/catalogue",
    key: "nav.catalogue",
    icon: (
      <>
        <rect x="3.5" y="4" width="7" height="7" rx="1.6" />
        <rect x="13.5" y="4" width="7" height="7" rx="1.6" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
      </>
    ),
  },
  {
    to: "/search",
    key: "nav.search",
    // Phone only: on a wide screen the search box itself is in the topbar.
    tabOnly: true,
    icon: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.2-3.2" />
      </>
    ),
  },
  {
    to: "/library",
    key: "nav.library",
    icon: <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.4L6 20V5a1 1 0 0 1 1-1Z" />,
  },
  {
    to: "/settings",
    key: "nav.settings",
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.2 14.4a1.6 1.6 0 0 0 .32 1.76l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.05-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.46v.17a1.9 1.9 0 1 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.76.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-.98h-.17a1.9 1.9 0 0 1 0-3.8h.09a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.76.32h.08a1.6 1.6 0 0 0 .97-1.46v-.17a1.9 1.9 0 1 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.77-.32l.05-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.46.97h.17a1.9 1.9 0 1 1 0 3.8h-.09a1.6 1.6 0 0 0-1.46.97Z" />
      </>
    ),
  },
];

function DestIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

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
              {/* The class is set explicitly rather than left to NavLink's
                  default, which is `active` — the stylesheet has always styled
                  `.is-active`, so the current page was never highlighted. */}
              {DESTINATIONS.filter((d) => !d.tabOnly).map((d) => (
                <NavLink
                  key={d.to}
                  to={d.to}
                  end={d.end}
                  className={({ isActive }) => (isActive ? "is-active" : "")}
                >
                  <span>{t(d.key)}</span>
                </NavLink>
              ))}
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

        {/* Phone navigation. Rendered at every width and hidden above 768px by
            CSS, so there is no width-dependent branch in JS to get wrong. */}
        <nav className="tabbar" aria-label="Hauptnavigation">
          {DESTINATIONS.map((d) => (
            <NavLink
              key={d.to}
              to={d.to}
              end={d.end}
              className={({ isActive }) => "tab" + (isActive ? " is-active" : "")}
            >
              <DestIcon>{d.icon}</DestIcon>
              <span>{t(d.key)}</span>
            </NavLink>
          ))}
        </nav>
      </div>
      <Chibi />
    </>
  );
}
