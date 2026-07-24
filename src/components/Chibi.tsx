import { useState } from "react";
import { ASSET_BASE } from "../lib/config";

// May, bottom-right — the zer0space mascot, decorative and dismissible. Clicking
// cycles the chibi sticker set. Purely personality: aria-hidden and never in the
// way of content.
const COUNT = 10;
const pad = (n: number) => String(n).padStart(2, "0");

export default function Chibi() {
  const [i, setI] = useState(() => 1 + Math.floor(Math.random() * COUNT));
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div className="chibi" aria-hidden="true">
      <button
        type="button"
        className="chibi-btn"
        tabIndex={-1}
        title="May"
        onClick={() => setI((v) => (v % COUNT) + 1)}
        onContextMenu={(e) => {
          e.preventDefault();
          setGone(true);
        }}
      >
        <img src={`${ASSET_BASE}/may/chibi-${pad(i)}.jpg`} alt="" width={84} height={84} />
      </button>
    </div>
  );
}
