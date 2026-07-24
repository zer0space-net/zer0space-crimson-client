import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="center-box">
      <div className="eyebrow">404</div>
      <h1>Verloren im Raum</h1>
      <p className="dim">Diese Seite gibt es nicht.</p>
      <Link className="btn btn-primary" to="/">
        Zur Startseite
      </Link>
    </div>
  );
}
