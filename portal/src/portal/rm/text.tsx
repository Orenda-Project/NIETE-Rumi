/**
 * bd-sex15q.17 — how a COPY string reaches an RM screen: the coach kit's rules (insights/text.tsx) over the RM keys
 * (rm.copy.ts) and the coach keys the RM pages share (§N nav, §WRow, §S6 marker, §E errors). `rt()` gives the filled
 * string; `rtx()` gives React nodes so "{n} of {d}" / "{d} میں سے {n}" becomes one <Num> carrying the DOM contract.
 */
import { Fragment, type ReactNode } from "react";
import type { Lang } from "../teacher/i18n";
import { COPY, type CopyKey } from "../coach/insights/copy";
import { digits, fill, isolate, type FillValue } from "../coach/insights/format";
import { Num } from "../coach/insights/count";
import type { CountSlot } from "../coach/insights/text";
import { RM_COPY, type RmCopyKey } from "./rm.copy";

export type AnyKey = RmCopyKey | CopyKey;

function template(key: AnyKey, lang: Lang): string {
  const entry = (RM_COPY as Record<string, { en: string; ur: string }>)[key] ?? (COPY as Record<string, { en: string; ur: string }>)[key];
  if (!entry) throw new Error(`rm copy: no key ${key}`);
  return entry[lang];
}

export function rt(key: AnyKey, lang: Lang, vars: Record<string, FillValue> = {}): string {
  return fill(template(key, lang), vars, lang);
}

type Var = FillValue | ReactNode;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tok = (s: string) => (/^[0-9]+$/.test(s) ? `(?:${s}|${digits(s, "ur")})` : `\\{${esc(s)}\\}`);

/** Render a COPY template with nodes; every CountSlot's "{n} of {d}" becomes a <Num>. Throws on a missing token. */
export function rtxTemplate(src: string, key: string, lang: Lang, vars: Record<string, Var> = {}, counts: readonly CountSlot[] = []): ReactNode {
  let tpl = src;
  const nodes: Record<string, ReactNode> = {};
  counts.forEach((c, i) => {
    const re = lang === "ur" ? new RegExp(`${tok(c.d)} میں سے ${tok(c.n)}`) : new RegExp(`${tok(c.n)} of ${tok(c.d)}`);
    if (!re.test(tpl)) throw new Error(`rm copy ${key}: no "${c.n} of ${c.d}" to carry the count`);
    tpl = tpl.replace(re, `{__count${i}}`);
    nodes[`__count${i}`] = <Num count={c.count} lang={lang} />;
  });
  const out: ReactNode[] = [];
  let last = 0;
  const re = /\{([a-z0-9_:]+)\}/g;
  for (let m = re.exec(tpl); m; m = re.exec(tpl)) {
    if (m.index > last) out.push(tpl.slice(last, m.index));
    const k = m[1];
    if (k in nodes) out.push(nodes[k]);
    else if (!(k in vars)) throw new Error(`rm copy ${key}: token {${k}} missing`);
    else {
      const v = vars[k];
      if (typeof v === "number") out.push(digits(v, lang));
      else if (typeof v === "string") out.push(isolate(v, lang));
      else out.push(v);
    }
    last = m.index + m[0].length;
  }
  if (last < tpl.length) out.push(tpl.slice(last));
  return <>{out.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>;
}

export function rtx(key: AnyKey, lang: Lang, vars: Record<string, Var> = {}, counts: readonly CountSlot[] = []): ReactNode {
  return rtxTemplate(template(key, lang), key, lang, vars, counts);
}
