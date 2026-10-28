import type { ReactNode } from "react";
import { CircleUserRound, ClipboardCheck, Languages, Loader2, LogOut, Map as MapIcon, type LucideIcon } from "lucide-react";
import { useLanguageSwitch } from "../../../teacher/useLanguageSwitch";
import { LangToggle } from "../../../coachip-ui/LangToggle";
import { TEACHER_FRAME } from "../../../teacher/copy";
import { useCopy, useLang } from "../../../teacher/i18n";
import { initials } from "../../../teacher/format";
import { COACH_PROFILE } from "../../profile/copy";
import { COPY } from "../copy";
import { rmPaths } from "../../../rm/paths";
import { COACH_MENU_PATHS } from "../../../teacher/menu";
import { FeatureGlyph } from "../../../teacher/icons";
import { Row } from "../../../coachip-ui/Row";
// More stands in TeacherPage, outside the COACHIP Shell: it brings the tokens itself (ux-system finding 143522). The
// import lives here, inside insights/, so coachip-ui stays reachable only from COACHIP (coachipUi.flagOff).
import "../../../coachip-ui/tokens.css";

/**
 * bd-sex15q.46 (R6, SCREENS.md More) — the body of the coach's More with COACHIP on (profile/CoachMore picks it): its
 * own `.cp` root, the who card as a navy band with the initials in a green tint circle, then hairline rows with 20 px
 * icons. With COACHIP off CoachMore draws its old markup and never mounts this.
 *
 * R6 fix cycle 1 (FIX_R6 A7, panel 230158: the one mixed screen): the heading is drawn by `MoreHead` inside its own `.cp`
 * root (24/800 navy, not the kit's 32 px light title) and the language row is a `.cp` row (lucide Languages, the kit's
 * label, coachip-ui's EN | اردو) through the same one writer as the kit's row; the kit's teacher More is untouched.
 */
export default function MoreCoachip({ name, phone, schools, rmOn, assess, onLogout }: {
  name: string; phone: string | null | undefined; schools: number | null; rmOn: boolean; assess: boolean; onLogout: () => void;
}) {
  const C = useCopy(TEACHER_FRAME);
  const P = useCopy(COACH_PROFILE);
  const lang = useLang();
  const counts = schools == null ? null : { schools };
  const guardedLogout = onLogout;
  return (
    <div className="cp flex flex-col gap-4">
      <section data-testid="more-who" className="flex items-center gap-3.5 rounded-[20px] bg-cp-navy px-5 py-5 text-white">
        <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-cp-green-tint text-[18px] font-bold text-cp-green-ink">
          {initials(name)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[17px] font-semibold leading-[1.4]">{name}</span>
          {(phone || counts) && (
            <span className="truncate text-[13px] leading-[1.45] text-white/75">
              <span dir="ltr">{phone}</span>{phone && counts ? " · " : ""}{counts ? P.schoolsN(counts.schools) : ""}
            </span>
          )}
        </span>
      </section>

      <CpGroup label={C.coachNav.training}>
        <Row testId="more-row-training" to={COACH_MENU_PATHS.training} lead={<CpGlyph name="training" />} title={C.coachNav.training} />
        <Row testId="more-row-lessons" to={COACH_MENU_PATHS.lessons} lead={<CpGlyph name="lessons" />} title={C.coachNav.lessons} />
        {rmOn && (
          <Row testId="more-row-rm" to={rmPaths.sector} lead={<CpIcon icon={MapIcon} />} title={COPY["more.rm"][lang]} />
        )}
        {assess && (
          <Row testId="more-row-assess" to="/portal/leader/assess" lead={<CpIcon icon={ClipboardCheck} />} title={P.assess} />
        )}
      </CpGroup>

      <CpGroup label={C.more.account}>
        <CpLanguageRow label={C.more.language} notSaved={C.more.notSaved} />
        <Row testId="more-row-profile" to="/portal/coach/profile" lead={<CpIcon icon={CircleUserRound} />} title={C.more.profile} />
        <button type="button" data-testid="more-row-logout" onClick={guardedLogout}
          className="flex min-h-[44px] w-full items-start gap-3 border-t border-cp-hairline py-3.5 text-start outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green">
          <CpIcon icon={LogOut} />
          <span className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{C.more.logout}</span>
        </button>
      </CpGroup>
    </div>
  );
}

/** R6: a group of More's rows, flat under a hairline (the kit's Card is a boxed card; the design system has none). */
function CpGroup({ label, children }: { label: string; children: ReactNode }) {
  return <nav aria-label={label} className="flex flex-col border-y border-cp-hairline">{children}</nav>;
}

/** R6: a row's 20 px lucide icon, navy, centred on the 17 px title's first line. */
function CpIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon size={20} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-cp-navy" />;
}

/**
 * R6: Training and Lesson Plans keep the kit's own glyphs at 20 px (already in the bundle; DESIGN_SYSTEM §8 names no
 * lucide icon for them, and the coach-entry budget has no room for new ones).
 */
function CpGlyph({ name }: { name: "training" | "lessons" }) {
  return <span aria-hidden="true" className="mt-0.5 flex shrink-0 text-cp-navy"><FeatureGlyph name={name} size={20} /></span>;
}

/** The page heading with COACHIP on: TeacherPage's `hero` slot, so the kit's light title is not drawn (FIX_R6 A7). */
export function MoreHead({ title }: { title: string }) {
  return (
    <div className="cp px-5 pb-1.5 pt-10 min-[576px]:px-1 min-[576px]:pt-6">
      <h1 data-testid="more-title" className="text-[24px] font-extrabold leading-[1.2] tracking-[-0.01em] text-cp-navy lg:text-[30px]">{title}</h1>
    </div>
  );
}

/**
 * R6 fix cycle 1: the language row as a `.cp` row. The switch is the kit's one writer (useLanguageSwitch → PUT
 * /me/language → setUserLanguage), shared with the toggle so "Not saved" shows when the server refused.
 */
function CpLanguageRow({ label, notSaved }: { label: string; notSaved: string }) {
  const sw = useLanguageSwitch();
  return (
    <Row testId="more-row-language" className="items-center" lead={<CpIcon icon={sw.status === "saving" ? Loader2 : Languages} />}
      title={label} meta={sw.status === "failed" ? notSaved : undefined} trail={<LangToggle prefix="more-lang" sw={sw} />} />
  );
}
