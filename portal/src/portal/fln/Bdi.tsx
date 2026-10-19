/**
 * Isolate every Latin/ASCII-digit run inside right-to-left text in its own <bdi>, so "SLO", "5",
 * "24/48" or "Level 1" keep their order in an Urdu line (DESIGN v2 §1 rules; the red team's rt_bidi_check counts any
 * such run outside <bdi>/dir=ltr as a FAIL). Left-to-right text is returned untouched. Text only: nothing here
 * interprets markup.
 */
import { Fragment, type ReactNode } from 'react';

/** Runs of Latin letters/digits joined by spaces or light punctuation: "SLO", "1 – 12", "c/k", "24/48", "Grade 1". */
const RUN = /[A-Za-z0-9]+(?:[ .,:'’/+\-–()%]+[A-Za-z0-9]+)*[%+]?/g;

export function bdiRuns(text: string, rtl: boolean): ReactNode {
  if (!rtl || !text) return text;
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(RUN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<bdi key={k++}>{m[0]}</bdi>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 ? out[0] : <Fragment>{out}</Fragment>;
}

/** `<Bdi rtl>{"سبق 24"}</Bdi>` → «سبق <bdi>24</bdi>». */
export function Bdi({ children, rtl }: { children: string | null | undefined; rtl: boolean }) {
  return <>{bdiRuns(children ?? '', rtl)}</>;
}
