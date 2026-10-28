import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useLang } from "../../../teacher/i18n";
import { CodeText, CountSpan, WindowMark } from "../count";
import { digits, range } from "../format";
import { pick, t, tx } from "../text";
import type { WRow as WRowData } from "../types";
import { RowCount } from "../../../coachip-ui/Count";
import { FractionBar } from "../../../coachip-ui/FractionBar";

/**
 * bd-sex15q.42 (R6) — the frame every weakness row shares, coach and sector alike (CODE_MAP C2: SectorWRow is built on
 * it): a hairline row (no boxed card; the hairline is between rows, never above the first), an optional lead (a ring,
 * on the RM's rows), the body, and a chevron when it goes somewhere. `agenda` (the cluster session's agenda row) gets
 * a green rule at its inline start.
 */
export function WRowFrame({ testId, w, state, kind, to, agenda, lead, children }: {
  testId: string; w: string; state: string; kind: "coach" | "sector"; to?: string; agenda?: boolean; lead?: React.ReactNode; children: React.ReactNode;
}) {
  const body = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-1">{children}</span>
      {to && <ChevronRight size={20} strokeWidth={1.5} className="shrink-0 self-center text-cp-ink-3 rtl:rotate-180" aria-hidden="true" />}
    </>
  );
  const cls = `flex w-full items-start gap-3 border-t border-cp-hairline py-3.5 text-start first:border-t-0 ${agenda ? "border-s-[3px] border-s-cp-green ps-3" : ""}`;
  const attrs = { "data-testid": testId, "data-w": w, "data-state": state, "data-wrow": kind, "data-agenda": agenda ? "1" : undefined };
  return to
    ? <Link to={to} {...attrs} className={`${cls} outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green`}>{body}</Link>
    : <div {...attrs} className={cls}>{body}</div>;
}

/**
 * bd-sex15q.15 — G9: ONE row for every weakness that is not the headline (S1's Move 2, S3's per-school top W, S6's rows,
 * the Not-yet list), in three states:
 *
 *   ranked     the count, "Move 2", the short name, the sentence, "{school} first (n of d) · range · grader"
 *   also_seen  the short name, the sentence, "{school} first (n of d) · range"
 *   not_yet    the short name, "{graded} of {needed} graded lessons · the card shows at {needed}", the codes line
 *
 * One `data-num/den/win` per count; the window resolves to the row's own meta element. `sectorLabel` (the sector's name)
 * is passed by a screen that knows it; without it the sector line is not drawn (it never shows a bare number).
 */
export function WRow({ row, to, sectorLabel, testId = "wrow" }: { row: WRowData; to?: string; sectorLabel?: string | null; testId?: string }) {
  const lang = useLang();
  const win = <WindowMark window={row.window} as="span">{range(row.window.from, row.window.to, lang)}</WindowMark>;
  let sub: React.ReactNode = null;
  if (row.state === "not_yet" && row.not_yet) {
    const g = row.not_yet.graded;
    sub = (
      <>
        {g && (
          <span className="block">
            {tx("wrow.not_yet.sub", lang, { needed: <span data-nonum="">{digits(g.d, lang)}</span> }, [{ n: "graded", d: "needed", count: g }])}
          </span>
        )}
        <CountSpan count={{ n: row.not_yet.codes_seen, d: row.not_yet.codes_needed, window_id: row.window.id }} className="block">
          {t("wrow.not_yet.codes", lang, { seen: row.not_yet.codes_seen, needed: row.not_yet.codes_needed })}
        </CountSpan>
        <span className="block">{win}</span>
      </>
    );
  } else {
    const wf = row.where_first;
    if (wf) {
      const key = row.state === "ranked" ? "wrow.ranked.sub" : "wrow.also_seen.sub";
      const vars: Record<string, React.ReactNode> = {
        school: <CodeText lang={lang}>{wf.school.school_name}</CodeText>,
        range: <WindowMark window={row.window} as="span">{range(row.window.from, row.window.to, lang)}</WindowMark>,
      };
      if (key === "wrow.ranked.sub") vars.grader_label = pick(row.window.grader_label, lang);
      sub = tx(key, lang, vars, [{ n: "n", d: "d", count: wf.count }]);
    } else {
      sub = win;
    }
  }
  const count = row.state !== "not_yet" ? row.count : null;
  return (
    <WRowFrame testId={testId} w={row.w_id} state={row.state} kind="coach" to={to}>
      {row.state === "ranked" && count && (
        <span data-nonum="" className="cp-label text-[12px] font-bold uppercase tracking-[0.08em] text-cp-ink-3">{t("s1.move_2", lang)}</span>
      )}
      <span className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{pick(row.short_name, lang)}</span>
      {row.state !== "not_yet" && <span className="text-[15px] leading-[1.45] text-cp-ink-2">{pick(row.sentence, lang)}</span>}
      {count && (
        <span className="mt-1 flex items-center gap-3">
          <RowCount count={count} lang={lang} className="shrink-0" />
          <FractionBar n={count.n} d={count.d} className="w-full max-w-[160px]" />
        </span>
      )}
      {sub && <span className="text-[13px] leading-[1.45] text-cp-ink-3">{sub}</span>}
      {row.sector && sectorLabel && (
        <span className="text-[13px] leading-[1.45] text-cp-ink-3">
          {tx("wrow.sector", lang, { sector: sectorLabel }, [{ n: "n", d: "d", count: row.sector }])}
        </span>
      )}
    </WRowFrame>
  );
}

/** Re-exported for screens that list counts beside a row. */
export { CountSpan };
