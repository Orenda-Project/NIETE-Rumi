import { CircleUserRound, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "../../hooks/useAuth";
import { useLogoutGuard } from "../../lib/recordingSession";
import TeacherPage from "../../teacher/TeacherPage";
import { Card, LanguageRow, ROW, RowLink, Tile } from "../../teacher/pages/More";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy } from "../../teacher/i18n";
import { formatPhone, fullName, initials } from "../../teacher/format";
import CoachGate from "../CoachGate";
import { COACH_PROFILE } from "./copy";
import { useCoachCounts } from "./useCoachCounts";

/**
 * bd-fmf24g.33 — the coach's More: who she is, then Language (English | اردو), My profile and Log out, as the teacher's.
 * Training is a Home tile, Certificates the Training hub's card, the child test a row on Home when her flag is on.
 * The school count under her name is the API's (`counts.schools`); nothing is shown when it cannot say.
 */
export default function CoachMore() {
  const C = useCopy(TEACHER_FRAME);
  const P = useCopy(COACH_PROFILE);
  const { user, logout } = useAuth();
  const guardedLogout = useLogoutGuard(logout);
  const counts = useCoachCounts();
  const name = fullName(user);
  const phone = formatPhone(user?.phoneNumber);

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

        <Card label={C.more.account}>
          <LanguageRow />
          <RowLink id="profile" to="/portal/coach/profile" icon={CircleUserRound} label={C.more.profile} />
          <button type="button" data-testid="more-row-logout" onClick={guardedLogout} className={cn(ROW, "text-[#c8331f]")}>
            <Tile icon={LogOut} hue={{ fg: "#c8331f", bg: "#fee4e2" }} />
            <span>{C.more.logout}</span>
          </button>
        </Card>
      </TeacherPage>
    </CoachGate>
  );
}
