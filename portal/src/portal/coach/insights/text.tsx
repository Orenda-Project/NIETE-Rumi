/**
 * bd-sex15q.15 — how a COPY string reaches a coach screen. `t()` gives the filled string; `tx()` gives React nodes so
 * a count inside a sentence ("{n} of {d}", "{d} میں سے {n}") becomes one <Num> carrying the DOM contract, and a date,
 * a code or a school name becomes its marked atom. No component writes words of its own (COPY §0, m-ui rules).
 */
import { Fragment, type ReactNode } from "react";
import { useLang, type Lang } from "../../teacher/i18n";
import { COPY, type CopyKey } from "./copy";
import { digits, fill, isolate, type FillValue } from "./format";
import { Num } from "./count";
import type { Count, Text } from "./types";

export function t(key: CopyKey, lang: Lang, vars: Record<string, FillValue> = {}): string {
  return fill(COPY[key][lang], vars, lang);
}

/** The server's own words (W sentences, glosses, note lines) in the page's language. */
export function pick(text: Text | null | undefined, lang: Lang): string {
  return text ? text[lang] : "";
}

/** A count inside a template: the tokens that say its n and d. `d` may be a literal ("3", "30", "5"). */
export type CountSlot = { n: string; d: string; count: Count };

type Var = FillValue | ReactNode;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tok = (s: string) => (/^[0-9]+$/.test(s) ? `(?:${s}|${digits(s, "ur")})` : `\\{${esc(s)}\\}`);

/**
 * Render a COPY string with nodes. Each CountSlot's "{n} of {d}" (English) or "{d} میں سے {n}" (Urdu) becomes a
 * <Num>; any other `{token}` takes its var (a string or number through §F's rules, or a node as it is).
 */
export function tx(key: CopyKey, lang: Lang, vars: Record<string, Var> = {}, counts: readonly CountSlot[] = []): ReactNode {
  let template: string = COPY[key][lang];
  const nodes: Record<string, ReactNode> = {};
  counts.forEach((c, i) => {
    const re = lang === "ur" ? new RegExp(`${tok(c.d)} میں سے ${tok(c.n)}`) : new RegExp(`${tok(c.n)} of ${tok(c.d)}`);
    if (!re.test(template)) throw new Error(`copy ${key}: no "${c.n} of ${c.d}" to carry the count`);
    template = template.replace(re, `{__count${i}}`);
    nodes[`__count${i}`] = <Num count={c.count} lang={lang} />;
  });
  const out: ReactNode[] = [];
  let last = 0;
  const re = /\{([a-z0-9_:]+)\}/g;
  for (let m = re.exec(template); m; m = re.exec(template)) {
    if (m.index > last) out.push(template.slice(last, m.index));
    const k = m[1];
    if (k in nodes) out.push(nodes[k]);
    else if (!(k in vars)) throw new Error(`copy ${key}: token {${k}} missing`);
    else {
      const v = vars[k];
      if (typeof v === "number") out.push(digits(v, lang));
      else if (typeof v === "string") out.push(isolate(v, lang));
      else out.push(v);
    }
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return <>{out.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>;
}

/** A component that renders one COPY key in the page's language. */
export function T({ k, vars, counts }: { k: CopyKey; vars?: Record<string, Var>; counts?: readonly CountSlot[] }) {
  const lang = useLang();
  return <>{tx(k, lang, vars, counts)}</>;
}
