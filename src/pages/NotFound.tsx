import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="center-box">
      <div className="eyebrow">404</div>
      <h1>{t("nf.title")}</h1>
      <p className="dim">{t("nf.sub")}</p>
      <Link className="btn btn-primary" to="/">
        {t("nf.home")}
      </Link>
    </div>
  );
}
