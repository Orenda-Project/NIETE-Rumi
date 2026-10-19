/**
 * bd-t7zk3t.11 — the plan page's text helpers. Text only: nothing here sets HTML; React escapes every string.
 *
 *  - `Chrome`   a chrome string (from strings.ts) with every Latin/ASCII-digit run AND every Urdu-digit run in its own
 *               <bdi class="n"> on a right-to-left page (DESIGN v2 §1: "every number/Latin run in Urdu chrome sits
 *               in <bdi>"). Left-to-right text is returned untouched.
 *  - `PlanText` the plan's own text, the markdown subset ONLY (plan-json contract): `**bold**`, `*italic*`, `\n`
 *               line breaks, lines starting `1. `. Everything else — `<script>`, `<img onerror>`, stray `*` — stays
 *               literal text. In rtl text the Latin/digit runs are isolated the same way.
 *  - `oneLine`  the first move as a single plain line (markers stripped) for a closed band.
 */
import { Fragment, type ReactNode } from 'react';

/** Latin/ASCII-digit runs (as Bdi.tsx / rt_bidi_check) or a run of Urdu digits ۰–۹ with its separators. */
const RUN = /[A-Za-z0-9]+(?:[ .,:'’/+\-–()%]+[A-Za-z0-9]+)*[%+]?|[۰-۹]+(?:[/–\-.,:][۰-۹]+)*/g;

export function isolate(text: string, rtl: boolean, keyPrefix = 'r'): ReactNode {
  if (!rtl || !text) return text;
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(RUN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<bdi className="n" key={`${keyPrefix}${k++}`}>{m[0]}</bdi>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 ? out[0] : <Fragment>{out}</Fragment>;
}

export function Chrome({ text, rtl }: { text: string; rtl: boolean }) {
  return <>{isolate(text, rtl)}</>;
}

/** `**bold**` first (it may hold `*italic*`), then `*italic*` (no space just inside the stars). */
const INLINE = /\*\*(.+?)\*\*|\*(?=\S)(.+?)(?<=\S)\*/g;

function inline(text: string, rtl: boolean, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={`${key}t${k++}`}>{isolate(text.slice(last, at), rtl, `${key}i${k}`)}</Fragment>);
    if (m[1] != null) out.push(<b key={`${key}b${k++}`}>{inline(m[1], rtl, `${key}b${k}`)}</b>);
    else out.push(<i key={`${key}e${k++}`}>{isolate(m[2], rtl, `${key}e${k}`)}</i>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`${key}t${k++}`}>{isolate(text.slice(last), rtl, `${key}z`)}</Fragment>);
  return out;
}

const NUM_LINE = /^\s*[0-9۰-۹]+[.)]\s/;

/** The plan numbers this step itself ("1. There are…"): its group then gets no badges (qa r1 D4). */
export const ownNumbered = (text: string | undefined | null): boolean => NUM_LINE.test(text || '');

export function PlanText({ text, rtl }: { text: string; rtl: boolean }) {
  const lines = (text || '').split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && !NUM_LINE.test(line) && !NUM_LINE.test(lines[i - 1]) ? <br /> : null}
          {NUM_LINE.test(line)
            ? <span className="fln-line-num">{inline(line.trim(), rtl, `l${i}`)}</span>
            : inline(line, rtl, `l${i}`)}
        </Fragment>
      ))}
    </>
  );
}

/** The first move on one line: markers removed, line breaks as spaces. */
export function oneLine(text: string | undefined | null): string {
  return (text || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '$1').replace(/\s*\n\s*/g, ' ').trim();
}
