/*
 * Dean Edwards' `p,a,c,k,e,d` unpacker — the deobfuscator for the packed JWPlayer
 * configs that Filemoon (and many JW-based hosters) ship. The player's `file:"…m3u8"`
 * lives inside an `eval(function(p,a,c,k,e,d){…}('payload',radix,count,'k|e|y…'
 * .split('|'),0,{}))` blob; this reverses it so a plain regex can pull the URL out.
 *
 * Uses the *canonical* packer encoder (the same `e()` the packer itself emits) so the
 * token→keyword substitution matches exactly, including bases >36 (Filemoon uses 62+),
 * where digits run 0-9a-zA-Z via `String.fromCharCode(c + 29)`.
 */

/** The canonical p.a.c.k.e.d index→token encoder (matches the packer's own `e`). */
function encodeToken(c: number, base: number): string {
  return (
    (c < base ? "" : encodeToken(Math.floor(c / base), base)) +
    ((c = c % base) > 35 ? String.fromCharCode(c + 29) : c.toString(36))
  );
}

/**
 * Unpack a `p,a,c,k,e,d` blob found anywhere in `source`. Returns the decoded script
 * text, or null when there's no packed payload (already-plain pages pass through the
 * caller's `|| html` fallback).
 */
export function unpackPacked(source: string): string | null {
  // Capture: payload, radix, count, keyword list. Non-greedy payload stops at the
  // terminating quote before `,<radix>` (internal quotes are backslash-escaped).
  const m = source.match(
    /\}\s*\(\s*'((?:\\.|[^\\'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\.|[^\\'])*)'\s*\.split\('\|'\)/,
  );
  if (!m) return null;

  const payload = m[1]!.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const radix = parseInt(m[2]!, 10) || 36;
  const count = parseInt(m[3]!, 10) || 0;
  const keywords = m[4]!.split("|");

  let result = payload;
  for (let i = count - 1; i >= 0; i--) {
    const kw = keywords[i];
    if (kw) {
      // Token chars are alphanumeric (0-9a-zA-Z), so \b boundaries are exact and no
      // regex-escaping is needed.
      result = result.replace(new RegExp("\\b" + encodeToken(i, radix) + "\\b", "g"), kw);
    }
  }
  return result;
}
