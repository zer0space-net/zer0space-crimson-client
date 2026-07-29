import { useState } from "react";
import { useI18n, type Lang } from "../lib/i18n";
import { ACCENTS, currentStored, setAccent } from "../lib/theme";
import { getLangPref, setLangPref, LANG_PREFS } from "../lib/prefs";

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const [stored, setStored] = useState(currentStored);
  const [langPref, setPref] = useState(getLangPref);

  function pickAccent(value: string) {
    setStored(value);
    setAccent(value);
  }
  function pickPref(v: string) {
    setPref(v);
    setLangPref(v);
  }

  return (
    <>
      <div className="page-head">
        <h1>{t("set.title")}</h1>
      </div>

      <div className="settings-grid">
        {/* Language of the interface */}
        <section className="panel glass">
          <header className="panel-head">
            <h2>{t("set.language")}</h2>
          </header>
          <div className="panel-body">
            <div className="lang-toggle" role="group" aria-label={t("set.language")}>
              {(["de", "en"] as Lang[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  onClick={() => setLang(l)}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Accent colour */}
        <section className="panel glass">
          <header className="panel-head">
            <h2>{t("set.appearance")}</h2>
          </header>
          <div className="panel-body stack gap-10">
            <label className="faint" style={{ fontSize: "0.82rem" }}>
              {t("set.accent")}
            </label>
            <div className="swatches">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="swatch"
                  title={a.label}
                  aria-pressed={stored.toLowerCase() === a.stored.toLowerCase()}
                  style={{ background: a.color, color: a.color }}
                  onClick={() => pickAccent(a.stored)}
                />
              ))}
            </div>
            <p className="faint" style={{ fontSize: "0.78rem" }}>
              {t("set.accentHint")}
            </p>
          </div>
        </section>

        {/* Preferred playback language */}
        <section className="panel glass">
          <header className="panel-head">
            <h2>{t("set.langPref")}</h2>
          </header>
          <div className="panel-body stack gap-10">
            <select
              className="input"
              value={langPref}
              onChange={(e) => pickPref(e.target.value)}
              style={{ maxWidth: 320 }}
            >
              {LANG_PREFS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.value === "" ? t("set.langAny") : p.label}
                </option>
              ))}
            </select>
            <p className="faint" style={{ fontSize: "0.78rem" }}>
              {t("set.langPrefHint")}
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
