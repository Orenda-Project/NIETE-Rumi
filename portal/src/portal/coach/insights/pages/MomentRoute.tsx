import { useParams } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import { useLoad } from "../useLoad";
import { InsightsPage, Eyebrow } from "../components/Frame";
import { StateBlock } from "../components/StateBlock";
import MomentSlot from "../MomentSlot";
import { CodeText, DateText } from "../count";
import { pick, t } from "../text";
import type { Moment } from "../types";
import api from "../../../services/api";

/**
 * bd-sex15q.15 — the address of S4 (`/portal/coach/insights/m/:momentId`), opened from a Listen row. S4 itself is
 * m-player's (insights/player): until that page lands this route shows the moment's header, its sentence and the
 * clip through MomentSlot; the swap is one import.
 */
export default function MomentRoute() {
  const { momentId = "" } = useParams();
  const lang = useLang();
  const { data, error } = useLoad<Moment>(() => api.get(`/coachip/m/${encodeURIComponent(momentId)}`).then((r) => r.data), [momentId]);
  return (
    <InsightsPage
      testId="insights-moment"
      backTo="/portal/coach/insights/listen"
      title={data ? <><CodeText lang={lang}>{data.code.code}</CodeText>{lang === "ur" ? "، " : " · "}<CodeText lang={lang}>{data.school.school_name}</CodeText></> : ""}
      crumb={data ? <DateText iso={data.session.recorded_on} lang={lang} /> : null}
      windows={[]}
    >
      {!data ? <StateBlock error={error} /> : (
        <section className="flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5">
          <Eyebrow k="eyebrow.listen" />
          <p className="text-[15px] leading-snug">{t("s4.sentence_frame", lang, { sentence: pick(data.w.sentence, lang) })}</p>
          <MomentSlot moment={data} />
          {data.gloss && <p className="rounded-xl bg-[#f9fafb] px-3 py-2 text-[14px]" data-text="library">{pick(data.gloss, lang)}</p>}
        </section>
      )}
    </InsightsPage>
  );
}
