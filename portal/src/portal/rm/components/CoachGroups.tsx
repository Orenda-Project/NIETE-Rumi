import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useLang } from "../../teacher/i18n";
import { dateShort, todayKarachi } from "../../coach/insights/format";
import type { Count } from "../../coach/insights/types";
import type { Coach, RmHome } from "../types";
import { rmPaths } from "../paths";
import { CountLine } from "./CountLine";
import { RmCard } from "./RmFrame";
import { WindowLegend, windowIds } from "./WindowLegend";
import { rt, rtx } from "../text";

/**
 * bd-sex15q.17 — "Which coach needs me this week" (S8, B9 add): two groups, `needs_me` then `on_track`, each in the
 * server's order (school-list order), no position number, no sort control, never a score. Each row: the coach's label
 * (the server's one string: a name inside the product, a C-code on fixtures), three activity lines (each a Count with
 * its base and window), one "Follow-up". A row opens S9.
 */
export function CoachRow({ coach, today, floorWeeks, onFollowUp }: { coach: Coach; today: string; floorWeeks: number; onFollowUp: (c: Coach) => void }) {
  const lang = useLang();
  const a = coach.activity;
  return (
    <li data-testid="coach-row" data-coach={coach.coach_user_id} className="flex items-start gap-3 py-2.5">
      <Link to={rmPaths.coach(coach.coach_user_id)} className="flex min-w-0 flex-1 items-start gap-3 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]">
        <span data-testid="coach-label" data-code="" dir="auto" className="min-w-[56px] shrink-0 pt-0.5 text-[15px] font-bold text-[#1d2025]">{coach.coach_label}</span>
        <span className="flex min-w-0 flex-col text-[13.5px] leading-[1.45] text-[#374151]">
          <CountLine k="s8.activity.unvisited" count={a.schools_unvisited} vars={{ w: floorWeeks }} none="s8.activity.unvisited.none" />
          <CountLine k="s8.activity.steps" count={a.debriefs_with_step} none="s8.activity.steps.none" />
          <CountLine k="s8.activity.overdue" count={a.checks_overdue} vars={{ date_short: dateShort(today, lang) }} none="s8.activity.overdue.none" />
          {coach.note_open && (
            <span data-testid="note-open" className="text-[12.5px] text-[#6b7280]">
              {rt("s8.follow_up", lang)}{lang === "ur" ? "، " : " · "}{rt(`s9.notes.status.${coach.note_open.status}` as const, lang)}
            </span>
          )}
        </span>
      </Link>
      <button type="button" data-testid="follow-up" onClick={() => onFollowUp(coach)}
        className="min-h-[44px] shrink-0 rounded-full border border-[#d1d5db] bg-white px-3.5 text-[13.5px] font-semibold text-[#1d2025] hover:bg-[#f9fafb]">
        {rt("s8.follow_up", lang)}
      </button>
    </li>
  );
}

function GroupHead({ k, count }: { k: "s8.group.needs_me" | "s8.group.on_track"; count?: Count }) {
  const lang = useLang();
  return (
    <div className="mt-2 flex flex-col">
      <h3 className="text-[12.5px] font-bold uppercase tracking-[0.06em] text-[#6b7280] rtl:tracking-normal">{rt(k, lang)}</h3>
      {count && count.d > 0 && <CountLine k="s8.on_track.row" count={count} className="text-[13px] text-[#6b7280]" />}
    </div>
  );
}

export function CoachGroups({ home, onFollowUp, testId = "coach-groups" }: { home: RmHome; onFollowUp: (c: Coach) => void; testId?: string }) {
  const lang = useLang();
  const today = todayKarachi(new Date(home.computed_at));
  const fw = home.opening.floor_weeks;
  const row = (c: Coach) => <CoachRow key={c.coach_user_id} coach={c} today={today} floorWeeks={fw} onFollowUp={onFollowUp} />;
  return (
    <RmCard testId={testId} title={rt("s8.needs.title", lang)} sub={rt("s8.needs.sub", lang)}>
      <WindowLegend windows={home.windows} ids={windowIds([home.groups, home.on_track_count])} />
      <div data-testid="group-needs_me">
        <GroupHead k="s8.group.needs_me" />
        <ul className="divide-y divide-[#f3f4f6]">{home.groups.needs_me.map(row)}</ul>
      </div>
      <div data-testid="group-on_track">
        <GroupHead k="s8.group.on_track" count={home.on_track_count} />
        <ul className="divide-y divide-[#f3f4f6]">{home.groups.on_track.map(row)}</ul>
      </div>
    </RmCard>
  );
}

/** S8's Friday-circle card (COPY v1.1): "{m} of {c} coaches have a moment · {n} of {d} checks due this week" (A6: m is a Count of coaches, c its base). */
export function CircleCard({ home }: { home: RmHome }) {
  const lang = useLang();
  const m = home.circle.moments;
  return (
    <Link to={rmPaths.circle} data-testid="rm-circle-card" className="flex items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[16px] font-semibold">{rt("s8.circle.title", lang)}</span>
        <WindowLegend windows={home.windows} ids={windowIds(home.circle)} />
        <span className="text-[14px] text-[#374151]">
          {rtx("s8.circle.sub", lang, {}, [{ n: "m", d: "c", count: m }, { n: "n", d: "d", count: home.circle.checks_due }])}
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}
