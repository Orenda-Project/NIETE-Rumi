import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, CircleAlert, Lock, Phone, School } from "lucide-react";
import { cn } from "@/lib/utils";
import api from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import TeacherPage from "../TeacherPage";
import { TEACHER_COPY as C } from "../copy";
import { cleanSchool, formatPhone, fullName, initials } from "../format";
import { teacherPath } from "../routes";

/**
 * bd-fmf24g.1 — teacher v2 My profile (canvas v28 Profile, change 8).
 *
 * Name, phone and school are SHOWN, not edited: no route lets a teacher change them
 * today (the only teacher-edit path is the coach's, via the /observe teacher admin).
 * Inventing one would be a schema/API decision, so the page does not pretend.
 *
 * Teaching level IS hers: GET/POST /training/bands (the band picker's route, bd-43487).
 * The options and their titles are the server's ("Primary (Grades 1-5)" → "Primary");
 * she may pick several; the 48-hour lock is the server's (`can_change`, `hours_remaining`,
 * 429 on a save inside the window) and shows as a chip, never as a sentence.
 */
type Bands = {
  options?: Array<{ id: string; title: string }>;
  selected?: string[];
  can_change?: boolean;
  hours_remaining?: number;
};

const statusOf = (err: unknown) => (err as { response?: { status?: number } } | null)?.response?.status;

/** "Primary (Grades 1-5)" → "Primary". A title in any other shape is shown whole. */
function shortLevel(title: string): string {
  const m = title.match(/^(.*?)\s*\(\s*grades?\s*\d+\s*[-–]\s*\d+\s*\)\s*$/i);
  return m ? m[1] : title;
}

function Field({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-[13px] font-semibold text-[#6b7280]">{label}</span>
      <div
        data-testid={testId}
        className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] px-4 text-[16px] font-semibold text-[#1d2025]"
      >
        {children}
      </div>
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const name = fullName(user);
  const phone = formatPhone(user?.phoneNumber);
  const school = cleanSchool(user?.schoolName);

  const [bands, setBands] = useState<Bands | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<"saved" | "locked" | "failed" | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const { data } = await api.get("/training/bands");
      setBands(data as Bands);
      setChosen(Array.isArray(data?.selected) ? data.selected : []);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const canChange = !!bands && bands.can_change !== false && outcome !== "locked";
  const hours = bands && bands.can_change === false ? Math.max(1, Math.round(Number(bands.hours_remaining) || 0)) : null;

  const toggle = (id: string) => {
    if (!canChange || saving) return;
    setOutcome(null);
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };

  const save = async () => {
    if (!canChange || saving || !chosen.length) return;
    setSaving(true);
    setOutcome(null);
    try {
      await api.post("/training/bands", { bands: chosen });
      setOutcome("saved");
      void load();
    } catch (err) {
      if (statusOf(err) === 429) {
        setOutcome("locked");
        void load();
      } else {
        setOutcome("failed");
      }
    } finally {
      setSaving(false);
    }
  };

  const options = (bands?.options || []).map((o) => ({ id: o.id, label: shortLevel(o.title) }));

  return (
    <TeacherPage
      title={C.profile.title}
      crumb={C.profile.crumb}
      backTo={teacherPath("more")}
      testId="teacher-profile"
      dock={bands ? (
        <button
          type="button"
          onClick={save}
          disabled={!canChange || saving || !chosen.length}
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-[16px] font-semibold text-white disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
        >
          <Check className="h-5 w-5" aria-hidden="true" />
          {C.profile.save}
        </button>
      ) : undefined}
    >
      <div className="flex items-center gap-3.5 px-1 pb-1">
        <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-[18px] font-bold text-white">
          {initials(name)}
        </span>
        <span className="truncate text-[18px] font-semibold">{name}</span>
      </div>

      <Field label={C.profile.name} testId="profile-name"><span className="truncate">{name}</span></Field>
      {phone && (
        <Field label={C.profile.phone} testId="profile-phone">
          <Phone className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />
          <span dir="ltr">{phone}</span>
        </Field>
      )}
      {school && (
        <Field label={C.profile.school} testId="profile-school">
          <School className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />
          <span className="truncate">{school}</span>
        </Field>
      )}

      <div className="flex flex-col gap-1.5 pt-1">
        <span id="profile-level" className="px-1 text-[13px] font-semibold text-[#6b7280]">{C.profile.level}</span>
        {loadFailed && !bands && (
          <button
            type="button"
            onClick={() => void load()}
            className="flex min-h-[56px] items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-[16px] font-semibold"
          >
            {C.tryAgain}
          </button>
        )}
        {bands && (
          <div role="group" aria-labelledby="profile-level" className="flex flex-col gap-2">
            {options.map((o) => {
              const on = chosen.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={!canChange || saving}
                  onClick={() => toggle(o.id)}
                  className={cn(
                    "flex min-h-[60px] items-center gap-3 rounded-2xl border bg-white px-4 text-start text-[16px] font-semibold disabled:opacity-60",
                    on ? "border-2 border-[#33374a] bg-[#f4f5f8]" : "border-[#e5e7eb]",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2",
                      on ? "border-[#33374a] bg-[#33374a] text-white" : "border-[#c7cad6]",
                    )}
                  >
                    {on && <Check className="h-4 w-4" />}
                  </span>
                  {o.label}
                </button>
              );
            })}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span data-testid="profile-lock" className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[#fef3c7] px-2.5 text-[12px] font-semibold text-[#b45309]">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                {hours != null ? C.profile.lockedFor(hours) : outcome === "locked" ? C.profile.locked : C.profile.lockedAfterSave}
              </span>
              {outcome === "saved" && (
                <span data-testid="profile-saved" className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[#eaf6ef] px-2.5 text-[12px] font-semibold text-[#2f7a52]">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />{C.profile.saved}
                </span>
              )}
              {outcome === "failed" && (
                <span data-testid="profile-error" className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[#fee4e2] px-2.5 text-[12px] font-semibold text-[#c8331f]">
                  <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />{C.profile.notSaved}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </TeacherPage>
  );
}
