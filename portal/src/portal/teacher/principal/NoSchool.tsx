import { School } from "lucide-react";
import { useCopy } from "../i18n";
import { PRINCIPAL } from "./copy";

/**
 * bd-r2uzg1.21.4 — a principal whose account names no school (users.school_id empty; the server says so: `school: null`
 * on GET /principal/school/card, `noSchool: true` on the leader reads). Her school is where every number of hers comes
 * from, so with none the pages read zeros and "No school" with no way on. This is the one notice they show instead:
 * the kit's empty row (EmptyRow's look: icon, then the words), with a second line saying what to do. Information, not
 * a control: nothing here is tappable. Words: principal/copy.ts (noSchoolTitle, noSchoolAsk), en + ur.
 */
export function NoSchoolNotice({ testId }: { testId: string }) {
  const P = useCopy(PRINCIPAL);
  return (
    <section data-testid={testId} className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-[#9ca3af]" aria-hidden="true">
        <School className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold leading-snug text-[#1d2025]">{P.noSchoolTitle}</h2>
        <p className="mt-0.5 text-[15px] leading-snug text-[#4b5563]">{P.noSchoolAsk}</p>
      </div>
    </section>
  );
}
