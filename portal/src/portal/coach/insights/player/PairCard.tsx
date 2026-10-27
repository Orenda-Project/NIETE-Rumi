import { Children, isValidElement, type ReactNode } from "react";
import type { Lang } from "../../../teacher/i18n";
import { CodeText, DateText } from "../count";
import type { CopyKey } from "../copy";
import { digits } from "../format";
import { pick, t, tx } from "../text";
import type { Moment } from "../types";

/**
 * bd-sex15q.16 — "What good sounds like" (DESIGN §3 S4): the same step done well by another code in the coach's own scope
 * (a nested `Moment`, `pair = null` inside it) with its own compact player (passed in as `children`, so this file does
 * not import the player that imports it) and its line `s4.pair.sub`; or, when no school in scope has one, the library's
 * example (`s4.pair.none` + `s4.pair.library`). `pair = null` (the RM circle form, a nested moment) shows nothing.
 * The library clip has no client route in API v1.4, so its example is named, not played (client_report, gaps).
 */
export default function PairCard({ pair, lang, children }: { pair: Moment["pair"]; lang: Lang; children?: ReactNode }) {
  if (!pair) return null;
  if ("library_clip" in pair) {
    return (
      <section data-testid="pair-card" data-pair="library" className="flex flex-col gap-1.5 border-t border-[#e5e7eb] pt-3">
        <h2 className="text-[16px] font-semibold text-[#1d2025]">{t("s4.pair.title", lang)}</h2>
        <p className="text-[13.5px] leading-snug text-[#6b7280]">{t("s4.pair.none", lang)}</p>
        <p className="text-[14.5px] leading-snug text-[#374151]">
          {tx("s4.pair.library", lang, { title: <span data-text="library">{pick(pair.library_clip.title, lang)}</span> })}
        </p>
      </section>
    );
  }
  const gs = gradeSubject(pair.session, lang);
  const sub = tx("s4.pair.sub", lang, {
    code: <CodeText lang={lang}>{pair.code.code}</CodeText>,
    school: <CodeText lang={lang}>{pair.school.school_name}</CodeText>,
    grade_subject: gs ?? NO_PART,
    date_short: <DateText iso={pair.session.recorded_on} lang={lang} short />,
  });
  return (
    <section data-testid="pair-card" data-pair="moment" className="flex flex-col gap-1.5 border-t border-[#e5e7eb] pt-3">
      <h2 className="text-[16px] font-semibold text-[#1d2025]">{t("s4.pair.title", lang)}</h2>
      <p data-testid="pair-sub" className="text-[13.5px] leading-snug text-[#6b7280]">{gs ? sub : dropPart(sub, NO_PART)}</p>
      {children}
      {pair.gloss_status === "ok" && pair.gloss && (
        <p className="rounded-xl border-s-4 border-[#47BA7D] bg-[#f9fafb] px-3 py-2 text-[14px] leading-snug" data-text="library">
          {pick(pair.gloss, lang)}
        </p>
      )}
    </section>
  );
}

/**
 * fix-r5 s2 item 2 (B17; qa-coach 073250): the session's subject arrives as a raw token from the plan ("maths", "Urdu",
 * "general_knowledge", "english_reading", any case, ≤ 40 chars). It reaches the screen only as a COPY word: the token is
 * matched by its first word to `s4.subject.*`; anything else is never shown.
 */
const SUBJECTS: [RegExp, CopyKey][] = [
  [/^urdu/, "s4.subject.urdu"],
  [/^english/, "s4.subject.english"],
  [/^math/, "s4.subject.maths"],
  [/^(general_?science|science)/, "s4.subject.science"],
  [/^(general_knowledge|gk$)/, "s4.subject.general_knowledge"],
  [/^islami(at|yat)/, "s4.subject.islamiat"],
  [/^(social_studies|sst$)/, "s4.subject.social_studies"],
];

export function subjectKey(subject: string | null | undefined): CopyKey | null {
  if (!subject) return null;
  const s = subject.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return SUBJECTS.find(([re]) => re.test(s))?.[1] ?? null;
}

/**
 * `s4.grade_subject` ("Grade 3 Urdu" / "جماعت ۳ اردو") when the session has a grade and a known subject; `s4.grade_only`
 * ("Grade 3") for an unknown subject; null without a grade. The grade is not a count (`data-nonum`).
 */
export function gradeSubject(session: Moment["session"] | undefined, lang: Lang): ReactNode | null {
  if (!session || session.grade == null || !session.subject) return null;
  const g = <span data-nonum="">{digits(session.grade, lang)}</span>;
  const key = subjectKey(session.subject);
  return key ? tx("s4.grade_subject", lang, { g, subject: t(key, lang) }) : tx("s4.grade_only", lang, { g });
}

/** A placeholder node for a template part the payload lacks; `dropPart` removes it and its separator. */
export const NO_PART = <span data-part="none" hidden />;

const SEP = /^\s*(·|،)\s*$/;

/**
 * Remove one token's node (and the " · " / "، " beside it) from what `tx()` rendered, so a line whose payload lacks a
 * part (no grade or subject; COPY §S4 "omit the parts the RM form lacks") reads without a dangling separator. The words
 * stay COPY's; only a part and its separator go.
 */
export function dropPart(node: ReactNode, part: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  const kids = Children.toArray((node.props as { children?: ReactNode }).children);
  const inner = kids.map((k) => (isValidElement(k) ? (k.props as { children?: ReactNode }).children : k));
  const i = inner.findIndex((x) => x === part);
  if (i < 0) return node;
  const drop = new Set([i]);
  if (typeof inner[i + 1] === "string" && SEP.test(inner[i + 1] as string)) drop.add(i + 1);
  else if (typeof inner[i - 1] === "string" && SEP.test(inner[i - 1] as string)) drop.add(i - 1);
  return <>{kids.filter((_, j) => !drop.has(j))}</>;
}
