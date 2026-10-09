import { Link } from "react-router-dom";
import { Lock, School, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "../../hooks/useAuth";
import { DELETE_ACCOUNT_PATH, PRIVACY_POLICY_PATH } from "../../lib/legalLinks";
import TeacherPage from "../../teacher/TeacherPage";
import { Card, Chevron, ROW, Tile } from "../../teacher/pages/More";
import { Field } from "../../teacher/pages/Profile";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy } from "../../teacher/i18n";
import { formatPhone, fullName, initials } from "../../teacher/format";
import CoachGate from "../CoachGate";
import { COACH_PROFILE } from "./copy";
import { useCoachCounts } from "./useCoachCounts";

/**
 * bd-4404s7.2 — the coach's own profile (Coach_Profile board). Name and phone are SHOWN, not edited (no route lets
 * her change them; a coach's own edit would be an API decision, so the page does not pretend). Schools opens the
 * Schools tab with the API's counts (`counts.schools`, `counts.teachers`), and nothing is drawn if they are unknown.
 * Account: Privacy policy and Delete account (Google Play needs both findable in the app, bd-3wb0s).
 */
export default function CoachProfile() {
  const C = useCopy(TEACHER_FRAME);
  const P = useCopy(COACH_PROFILE);
  const { user } = useAuth();
  const counts = useCoachCounts();
  const name = fullName(user);
  const phone = formatPhone(user?.phoneNumber);

  return (
    <CoachGate>
      <TeacherPage title={C.profile.title} crumb={C.profile.crumb} backTo="/portal/coach/more" testId="coach-profile">
        <div className="flex items-center gap-3.5 px-1 pb-1">
          <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-[22px] font-bold text-white">
            {initials(name)}
          </span>
          <span className="truncate text-[20px] font-semibold">{name}</span>
        </div>

        <Field label={C.profile.name} testId="profile-name"><span className="truncate">{name}</span></Field>
        {phone && (
          <Field label={C.profile.phone} testId="profile-phone">
            <Lock className="h-[18px] w-[18px] shrink-0 text-[#6b7280]" aria-hidden="true" />
            <span dir="ltr">{phone}</span>
          </Field>
        )}

        {counts && (
          <div className="flex flex-col gap-1.5">
            <span className="px-1 text-[13px] font-semibold text-[#6b7280]">{P.schools}</span>
            <Link
              to="/portal/coach/people"
              data-testid="profile-schools"
              className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-3 py-2.5 text-start shadow-[0_1px_3px_rgba(16,24,40,0.08)] outline-none hover:bg-[#f9fafb] focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]"
            >
              <Tile icon={School} />
              <span className="flex min-w-0 flex-col">
                <span className="text-[17px] font-semibold">{P.schoolsN(counts.schools)}</span>
                <span className="text-[13px] font-medium text-[#6b7280]">{P.teachersN(counts.teachers)}</span>
              </span>
              <Chevron />
            </Link>
          </div>
        )}

        <div className="flex flex-col gap-1.5 pt-1">
          <span className="px-1 text-[13px] font-semibold text-[#6b7280]">{P.account}</span>
          <Card label={P.account}>
            <Link to={PRIVACY_POLICY_PATH} className={ROW}>
              <Tile icon={ShieldCheck} />
              <span className="min-w-0 truncate">{P.privacy}</span>
              <Chevron />
            </Link>
            <Link to={DELETE_ACCOUNT_PATH} className={cn(ROW, "text-[#c8331f]")}>
              <Tile icon={Trash2} hue={{ fg: "#c8331f", bg: "#fee4e2" }} />
              <span className="min-w-0 truncate">{P.deleteAccount}</span>
              <Chevron />
            </Link>
          </Card>
        </div>
      </TeacherPage>
    </CoachGate>
  );
}
