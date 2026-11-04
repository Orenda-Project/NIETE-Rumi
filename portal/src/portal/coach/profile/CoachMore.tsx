import { CircleUserRound, ClipboardCheck, LogOut, Map as MapIcon, MessageSquareWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "../../hooks/useAuth";
import { useLogoutGuard } from "../../lib/recordingSession";
import TeacherPage from "../../teacher/TeacherPage";
import { Card, LanguageRow, ROW, RowLink, Tile } from "../../teacher/pages/More";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy, useLang } from "../../teacher/i18n";
import { formatPhone, fullName, initials } from "../../teacher/format";
import CoachGate from "../CoachGate";
import { COACH_PROFILE } from "./copy";
import { REPORT_PATH } from "./paths";
import { useCoachCounts } from "./useCoachCounts";
import { useChildTestSa } from "../../lib/useChildTestSa";
import { useCoachip, useCoachipRm } from "../insights/useCoachip";
import { COPY } from "../insights/copy";
import { rmPaths } from "../../rm/paths";
import MoreCoachip, { MoreHead } from "../insights/components/MoreCoachip";

/**
 * bd-fmf24g.33 — the coach's More: who they are, then Language (English | اردو), My profile and Log out, as the teacher's.
 * Training is a Home tile, Certificates the Training hub's card, the child test a row on Home when their flag is on.
 * With portal_child_test_sa on, the Learning assessment is a row here too: a coach on v2 has no Home to reach it from.
 * The school count under their name is the API's (`counts.schools`); nothing is shown when it cannot say.
 *
 * R6 (bd-sex15q.46, SCREENS.md More): with COACHIP on, the page wears the design system: its own `.cp` root (More is
 * outside the Shell, so the tokens paint nothing without it), the who card a navy band with the initials in a green
 * tint circle, then hairline rows with 20 px lucide icons; the kit's LanguageRow as it is. With COACHIP off, absent or
 * failing, the markup below is exactly what it was (more.flagOff: no `cp` class anywhere).
 */
export default function CoachMore() {
  const C = useCopy(TEACHER_FRAME);
  const P = useCopy(COACH_PROFILE);
  const { user, logout } = useAuth();
  const guardedLogout = useLogoutGuard(logout);
  const counts = useCoachCounts();
  const assess = useChildTestSa() === true;
  // bd-sex15q.15 — with COACHIP on, the menu is This week · Schools · Listen · Stats · More, so the Training Library and
  // Lesson Plans move here (the lead's decision: training stays one tap away). Off: nothing changes on this page.
  const coachip = useCoachip(user?.phoneNumber || null) === true;
  // fix-r5 (SPEC v2.1 §11.6 option a): a coach who is also the sector's RM reaches the RM pages from here; the bar stays
  // five. Shown only for a literal `features.coachipRm === true`; the row is a link, it reads nothing from /coachip/.
  const rmOn = useCoachipRm() === true;
  const lang = useLang();
  const name = fullName(user);
  const phone = formatPhone(user?.phoneNumber);

  if (coachip) {
    return (
      <CoachGate>
        {/* FIX_R6 A7: the heading is the design system's (MoreHead in the hero slot), not the kit's light title */}
        <TeacherPage hero={<MoreHead title={C.more.title} />} testId="coach-more">
          <MoreCoachip name={name} phone={phone} schools={counts ? counts.schools : null} rmOn={rmOn} assess={assess} onLogout={guardedLogout} />
        </TeacherPage>
      </CoachGate>
    );
  }

  return (
    <CoachGate>
      <TeacherPage title={C.more.title} testId="coach-more">
        <section
          data-testid="more-who"
          className="flex items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
        >
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-[18px] font-bold text-white">
            {initials(name)}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[17px] font-semibold">{name}</span>
            {(phone || counts) && (
              <span className="truncate text-[13px] text-[#6b7280]">
                <span dir="ltr">{phone}</span>{phone && counts ? " · " : ""}{counts ? P.schoolsN(counts.schools) : ""}
              </span>
            )}
          </span>
        </section>

        {rmOn && (
          <Card label={COPY["more.rm"][lang]}>
            <RowLink id="rm" to={rmPaths.sector} icon={MapIcon} label={COPY["more.rm"][lang]} />
          </Card>
        )}

        {assess && (
          <Card label={P.assess}>
            <RowLink id="assess" to="/portal/leader/assess" icon={ClipboardCheck} label={P.assess} />
          </Card>
        )}

        <Card label={C.more.account}>
          <LanguageRow />
          <RowLink id="profile" to="/portal/coach/profile" icon={CircleUserRound} label={C.more.profile} />
          <RowLink id="report" to={REPORT_PATH} icon={MessageSquareWarning} label={P.report} />
          <button type="button" data-testid="more-row-logout" onClick={guardedLogout} className={cn(ROW, "text-[#c8331f]")}>
            <Tile icon={LogOut} hue={{ fg: "#c8331f", bg: "#fee4e2" }} />
            <span>{C.more.logout}</span>
          </button>
        </Card>
      </TeacherPage>
    </CoachGate>
  );
}
