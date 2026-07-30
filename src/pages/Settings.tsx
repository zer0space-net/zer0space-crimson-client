import { useState } from "react";
import { useI18n, type Lang } from "../lib/i18n";
import { ACCENTS, currentStored, setAccent } from "../lib/theme";
import {
  getLangPref,
  setLangPref,
  LANG_PREFS,
  getDubSub,
  setDubSub,
  DUB_SUB_OPTS,
  type DubSub,
  getSubLangs,
  setSubLangs,
  SUBTITLE_LANGS,
} from "../lib/prefs";

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const [stored, setStored] = useState(currentStored);
  const [langPref, setPref] = useState(getLangPref);
  const [dubSub, setDub] = useState<DubSub>(getDubSub);
  const [subLangs, setSubs] = useState<string[]>(getSubLangs);

  function pickAccent(value: string) {
    setStored(value);
    setAccent(value);
  }
  function pickPref(v: string) {
    setPref(v);
    setLangPref(v);
  }
  function pickDubSub(v: DubSub) {
    setDub(v);
    setDubSub(v);
  }
  function toggleSub(code: string) {
    const next = subLangs.includes(code)
      ? subLangs.filter((c) => c !== code)
      : [...subLangs, code];
    setSubs(next);
    setSubLangs(next);
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

        {/* Playback language: preferred language + dub/sub + subtitle languages */}
        <section className="panel glass" style={{ gridColumn: "1 / -1" }}>
          <header className="panel-head">
            <h2>{t("set.langPref")}</h2>
          </header>
          <div className="panel-body stack gap-18">
            {/* Preferred language */}
            <div className="stack gap-8">
              <label className="set-label">{t("set.langPref")}</label>
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
              <p className="set-hint">{t("set.langPrefHint")}</p>
            </div>

            {/* Dub or Sub */}
            <div className="stack gap-8">
              <label className="set-label">{t("set.dubSub")}</label>
              <div className="seg" role="group" aria-label={t("set.dubSub")}>
                {DUB_SUB_OPTS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={dubSub === o.value}
                    onClick={() => pickDubSub(o.value)}
                  >
                    {t(o.key)}
                  </button>
                ))}
              </div>
              <p className="set-hint">{t("set.dubSubHint")}</p>
            </div>

            {/* Subtitle languages */}
            <div className="stack gap-8">
              <label className="set-label">{t("set.subLangs")}</label>
              <div className="chip-check-group">
                {SUBTITLE_LANGS.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    className={"chip-check" + (subLangs.includes(s.code) ? " is-on" : "")}
                    aria-pressed={subLangs.includes(s.code)}
                    onClick={() => toggleSub(s.code)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="set-hint">{t("set.subLangsHint")}</p>
              <p className="faint" style={{ fontSize: "0.72rem" }}>
                {t("set.savedAuto")}
              </p>
            </div>

            <p className="set-hint" style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              {t("set.autoplayNote")}
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
