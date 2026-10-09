import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";
import { Link } from "react-router-dom";
import {
  Award, BarChart3, ChevronRight, CircleUserRound, Languages, Loader2, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "../../hooks/useAuth";
import { useLogoutGuard } from "../../lib/recordingSession";
import TeacherPage from "../TeacherPage";
import { FEATURE_HUE, FeatureGlyph, type GlyphName } from "../icons";
import { TEACHER_FRAME } from "../copy";
import { useCopy } from "../i18n";
import { cleanSchool, formatPhone, fullName, initials } from "../format";
import { teacherPath } from "../routes";
import { useLanguageSwitch } from "../useLanguageSwitch";

/**
 * bd-fmf24g.1 — teacher v2 More (canvas v28 More, after changes 8 and the wiring): who she
 * is, then the features the menu bar does not hold.
 *   Assessment · Attendance · My Classes · Analytics
 *   Certificates
 *   Language · My profile · Logout
 * No counts on the rows: nothing here shows a number the API does not send.
 */
type Glyph = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

export const ROW = cn(
  "flex min-h-[64px] w-full items-center gap-3.5 border-t border-[#f0f1f3] px-3 py-2 text-start text-[16px] font-semibold first:border-t-0",
  "outline-none hover:bg-[#f9fafb] focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[#f59e0b]",
);

export function Tile({ icon: Icon, glyph, hue }: { icon?: Glyph; glyph?: GlyphName; hue?: { fg: string; bg: string } }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]"
      // The glyph's knocked-out details take the tile's tint (teacher/icons: CSS --cut).
      style={hue ? ({ background: hue.bg, color: hue.fg, "--cut": hue.bg } as CSSProperties) : undefined}
    >
      {glyph ? <FeatureGlyph name={glyph} size={22} /> : Icon ? <Icon className="h-[22px] w-[22px]" /> : null}
    </span>
  );
}

export function Chevron() {
  return <ChevronRight className="ms-auto h-[22px] w-[22px] shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />;
}

export function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      {children}
    </nav>
  );
}

export function RowLink({ id, to, icon, glyph, hue, label }: { id: string; to: string; icon?: Glyph; glyph?: GlyphName; hue?: { fg: string; bg: string }; label: string }) {
  return (
    <Link to={to} data-testid={`more-row-${id}`} className={ROW}>
      <Tile icon={icon} glyph={glyph} hue={hue} />
      <span className="min-w-0 truncate">{label}</span>
      <Chevron />
    </Link>
  );
}

/**
 * The Language row: names the language it switches TO, in that language's own script (the kit's one switch,
 * useLanguageSwitch → the bot's setUserLanguage). Shared with the coach's More (bd-4404s7.2).
 */
export function LanguageRow() {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLanguageSwitch();
  return (
    <button type="button" data-testid="more-row-language" onClick={lang.toggle} disabled={lang.status === "saving"} className={ROW}>
      <Tile icon={lang.status === "saving" ? Loader2 : Languages} />
      <span className="min-w-0 truncate">{C.more.language}</span>
      {lang.status === "failed" && (
        <span className="ms-auto inline-flex h-[26px] items-center rounded-full bg-[#fee4e2] px-2.5 text-[12px] font-semibold text-[#c8331f]">
          {C.more.notSaved}
        </span>
      )}
      <span
        lang={lang.target}
        className={cn(
          "inline-flex h-[26px] items-center rounded-full bg-[#f3f4f6] px-2.5 text-[12px] font-semibold text-[#374151]",
          lang.status === "failed" ? "" : "ms-auto",
        )}
      >
        {C.more.switchTo[lang.target]}
      </span>
    </button>
  );
}

export default function More() {
  const C = useCopy(TEACHER_FRAME);
  const { user, logout } = useAuth();
  const guardedLogout = useLogoutGuard(logout);
  const name = fullName(user);
  const phone = formatPhone(user?.phoneNumber);
  const school = cleanSchool(user?.schoolName);

  return (
    <TeacherPage title={C.more.title} testId="teacher-more">
      <section
        data-testid="more-who"
        className="flex items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
      >
        <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-[18px] font-bold text-white">
          {initials(name)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[17px] font-semibold">{name}</span>
          {(phone || school) && (
            <span className="truncate text-[13px] text-[#6b7280]">
              <span dir="ltr">{phone}</span>{phone && school ? " · " : ""}{school}
            </span>
          )}
        </span>
      </section>

      <Card label={C.more.teaching}>
        <RowLink id="assessment" to={teacherPath("assessment")} glyph="assessment" hue={FEATURE_HUE.assessment} label={C.more.assessment} />
        <RowLink id="attendance" to={teacherPath("attendance")} glyph="attendance" hue={FEATURE_HUE.attendance} label={C.more.attendance} />
        <RowLink id="classes" to={teacherPath("classes")} glyph="classes" hue={FEATURE_HUE.classes} label={C.more.classes} />
        <RowLink id="analytics" to={teacherPath("analytics")} icon={BarChart3} label={C.more.analytics} />
      </Card>

      <Card label={C.more.records}>
        <RowLink id="certificates" to="/portal/training/certificates" icon={Award} hue={FEATURE_HUE.training} label={C.more.certificates} />
      </Card>

      <Card label={C.more.account}>
        <LanguageRow />
        <RowLink id="profile" to={teacherPath("profile")} icon={CircleUserRound} label={C.more.profile} />
        <button
          type="button"
          data-testid="more-row-logout"
          onClick={guardedLogout}
          className={cn(ROW, "text-[#c8331f]")}
        >
          <Tile icon={LogOut} hue={{ fg: "#c8331f", bg: "#fee4e2" }} />
          <span>{C.more.logout}</span>
        </button>
      </Card>
    </TeacherPage>
  );
}
