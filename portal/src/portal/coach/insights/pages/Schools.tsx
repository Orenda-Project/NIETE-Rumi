import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { coachip } from "../api";
import { useLoad } from "../useLoad";
import { InsightsPage, MetaLine } from "../components/Frame";
import { StateBlock } from "../components/StateBlock";
import { WRow } from "../components/WRow";
import { CodeText, DateText } from "../count";
import { insightsPaths } from "../paths";
import { t, tx } from "../text";
import type { SchoolsList } from "../types";

/**
 * bd-sex15q.15 — the Schools tab (`/schools`, `GET /coachip/schools`): every school in the coach's scope, in the API's
 * order (oldest visit first, never visited first, then name; never by a count). Each: the school's name, its last
 * visit and "g of r graded", then this month's top W as the one WRow (G9) or "nothing to do here this month".
 * A top-level page (no back). The read sits inside the gate (B7).
 *
 * R6 (bd-sex15q.46, SCREENS.md Schools): the band carries the window as its one line; each school is a hairline row
 * (name 17/600, the visit line 13 ink-3), its top W the WRow (ux-system's). Colour only through the coachip-ui tokens.
 */
export default function Schools() {
  return (
    <InsightsGate>
      <SchoolsBody />
    </InsightsGate>
  );
}

function SchoolsBody() {
  const lang = useLang();
  const { data, error } = useLoad<SchoolsList>(() => coachip.schools(), []);
  return (
    <InsightsPage
      testId="insights-schools"
      title={t("schools.title", lang)}
      windows={data ? data.windows ?? [data.window] : null}
      chips={data ? <MetaLine window={data.window} className="text-[14px] leading-snug" /> : error ? undefined : null}
    >
      {!data ? <StateBlock error={error} /> : (
        <div className="flex flex-col">
          <ul className="flex flex-col">
            {data.schools.map((s) => (
              <li key={s.school.school_id} data-testid="schools-row" data-school={s.school.school_id}
                className="flex flex-col gap-2.5 border-t border-cp-hairline py-4 first:border-t-0 first:pt-1">
                <div>
                  <p className="text-[17px] font-semibold leading-[1.4] text-cp-ink [overflow-wrap:anywhere]">
                    <CodeText lang={lang}>{s.school.school_name}</CodeText>
                  </p>
                  {/* the "g of r" count (one Num node inside the one COPY line) wears the tint chip: Pill's look, no new words */}
                  <p className="mt-0.5 text-[13px] leading-[1.7] text-cp-ink-3 [&_[data-num]]:inline-block [&_[data-num]]:whitespace-nowrap [&_[data-num]]:rounded-full [&_[data-num]]:bg-cp-green-tint [&_[data-num]]:px-2 [&_[data-num]]:text-[12px] [&_[data-num]]:font-semibold [&_[data-num]]:leading-[1.6] [&_[data-num]]:text-cp-green-ink">
                    {s.last_visit
                      ? tx("schools.row.sub", lang, { date: <DateText iso={s.last_visit} lang={lang} /> }, [{ n: "g", d: "r", count: s.graded }])
                      : t("schools.row.never", lang)}
                  </p>
                </div>
                {s.top_w
                  ? <WRow row={s.top_w} to={insightsPaths.w(s.top_w.w_id)} screenWindow={data.window.id} />
                  // fix-r5 s2 item 3/4 (qa-coach 073419, B10): "nothing to do" only when the school has no graded lesson;
                  // graded lessons without a ranked move are "not ranked yet", words only
                  : s.graded.n > 0
                    ? <p data-testid="schools-top-none" data-state="not_ranked" className="rounded-[12px] bg-cp-navy-tint px-4 py-3 text-[15px] leading-[1.45] text-cp-ink-2">{t("schools.top_w.not_ranked", lang)}</p>
                    : <p data-testid="schools-top-none" data-state="none" className="rounded-[12px] bg-cp-navy-tint px-4 py-3 text-[15px] leading-[1.45] text-cp-ink-2">{t("schools.top_w.none", lang)}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </InsightsPage>
  );
}
