import { useParams } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { useLoad } from "../useLoad";
import { InsightsPage } from "../components/Frame";
import { StateBlock } from "../components/StateBlock";
import MomentPage, { MomentSub } from "../player/Moment";
import { CodeText } from "../count";
import type { Moment } from "../types";
import api from "../../../services/api";

/**
 * bd-sex15q.15 — the address of S4 (`/portal/coach/insights/m/:momentId`), opened from a Listen row. The read sits
 * inside the gate (B7: with portal_coachip off no /coachip/m/ request fires); the page body is m-player's
 * (insights/player/Moment.tsx, bd-sex15q.16). App bar: "{code} · {school}", the school alone for the RM circle form
 * (API R6, B22: no code); its sub line is S4's `s4.appbar.sub`.
 */
export default function MomentRoute() {
  return (
    <InsightsGate>
      <MomentRouteBody />
    </InsightsGate>
  );
}

function MomentRouteBody() {
  const { momentId = "" } = useParams();
  const lang = useLang();
  const { data, error } = useLoad<Moment>(() => api.get(`/coachip/m/${encodeURIComponent(momentId)}`).then((r) => r.data), [momentId]);
  const code = (data as Partial<Moment> | null)?.code;
  return (
    <InsightsPage
      testId="insights-moment"
      backTo="/portal/coach/insights/listen"
      title={data ? <>{code ? <><CodeText lang={lang}>{code.code}</CodeText>{lang === "ur" ? "، " : " · "}</> : null}<CodeText lang={lang}>{data.school.school_name}</CodeText></> : ""}
      crumb={data && (data as Partial<Moment>).session ? <MomentSub moment={data} /> : null}
      windows={[]}
    >
      {!data ? <StateBlock error={error} /> : <MomentPage moment={data} />}
    </InsightsPage>
  );
}
