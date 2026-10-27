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
    <InsightsPage testId="insights-schools" title={t("schools.title", lang)} windows={data ? data.windows ?? [data.window] : null}>
      {!data ? <StateBlock error={error} /> : (
        <div className="flex flex-col gap-3">
          <MetaLine window={data.window} className="px-1 text-[12.5px] leading-snug text-[#6b7280]" />
          <ul className="flex flex-col gap-3">
            {data.schools.map((s) => (
              <li key={s.school.school_id} data-testid="schools-row" data-school={s.school.school_id}
                className="flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] p-3">
                <div className="px-1">
                  <p className="text-[15.5px] font-semibold leading-snug text-[#1d2025] [overflow-wrap:anywhere]">
                    <CodeText lang={lang}>{s.school.school_name}</CodeText>
                  </p>
                  <p className="text-[13px] leading-snug text-[#6b7280]">
                    {s.last_visit
                      ? tx("schools.row.sub", lang, { date: <DateText iso={s.last_visit} lang={lang} /> }, [{ n: "g", d: "r", count: s.graded }])
                      : t("schools.row.never", lang)}
                  </p>
                </div>
                {s.top_w
                  ? <WRow row={s.top_w} to={insightsPaths.w(s.top_w.w_id)} />
                  // fix-r5 s2 item 3/4 (qa-coach 073419, B10): "nothing to do" only when the school has no graded lesson;
                  // graded lessons without a ranked move are "not ranked yet", words only
                  : s.graded.n > 0
                    ? <p data-testid="schools-top-none" data-state="not_ranked" className="px-1 text-[14px] text-[#6b7280]">{t("schools.top_w.not_ranked", lang)}</p>
                    : <p data-testid="schools-top-none" data-state="none" className="px-1 text-[14px] text-[#6b7280]">{t("schools.top_w.none", lang)}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </InsightsPage>
  );
}
