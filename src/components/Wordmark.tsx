import { Link } from "react-router-dom";

// "zer0space ✕ Crimson" — the zer0space wordmark with a crimson cross joining
// the Crimson Haven name, so the origin of the streaming engine is legible in
// the brand itself.
export default function Wordmark() {
  return (
    <Link to="/" className="brand" aria-label="zer0space ✕ Crimson — Start">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6.5 5 11 7-11 7z" />
        </svg>
      </span>
      <span className="wordmark">
        <span className="zero">zer0space</span>
        <span className="x" aria-hidden="true">✕</span>
        <span className="crimson">Crimson</span>
      </span>
    </Link>
  );
}
