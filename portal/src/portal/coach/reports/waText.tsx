/**
 * bd-o15qnr.48 (queue #244; #234's issue 6) — WhatsApp's own marks, drawn as WhatsApp draws them, for a preview of words
 * a teacher gets on WhatsApp: *bold*, _italic_, ~struck~. A mark counts only as WhatsApp counts it: it opens after a
 * space, the start or an opening bracket/quote, closes before a space, the end or punctuation, has a letter right inside
 * each end and never spans a line ("2 * 3", "snake_case" and a lone "*" stay as typed). Not nested. Display only: the
 * text sent is the bot's, untouched.
 */
export type WaPart = { t: string; b?: true; i?: true; s?: true };

const MARK = /(^|[\s([{"'“‘])([*_~])(?=\S)([^\n]*?\S)\2(?=$|[\s.,!?:;)\]}"'”’])/g;
const KIND: Record<string, "b" | "i" | "s"> = { "*": "b", _: "i", "~": "s" };

export function waParts(text: string): WaPart[] {
  const out: WaPart[] = [];
  const plain = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && !last.b && !last.i && !last.s) last.t += t;
    else out.push({ t });
  };
  let at = 0;
  for (const m of text.matchAll(MARK)) {
    const start = m.index ?? 0;
    plain(text.slice(at, start) + m[1]);
    out.push({ t: m[3], [KIND[m[2]]]: true } as WaPart);
    at = start + m[0].length;
  }
  plain(text.slice(at));
  return out;
}

/** The text with its WhatsApp marks drawn (the container keeps the line breaks: whitespace-pre-line). */
export function WaText({ text }: { text: string }) {
  return (
    <>
      {waParts(text).map((p, k) => (p.b ? <strong key={k}>{p.t}</strong> : p.i ? <em key={k}>{p.t}</em> : p.s ? <s key={k}>{p.t}</s> : <span key={k}>{p.t}</span>))}
    </>
  );
}
