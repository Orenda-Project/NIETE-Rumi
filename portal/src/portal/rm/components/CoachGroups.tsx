import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useLang } from "../../teacher/i18n";
import { dateShort, todayKarachi } from "../../coach/insights/format";
import type { Count } from "../../coach/insights/types";
import type { Coach, RmHome } from "../types";
import { rmPaths } from "../paths";
import { CountLine } from "./CountLine";
import { Section } from "../../coachip-ui/Section";
import { Button } from "../../coachip-ui/Button";
import { WindowLegend, windowIds } from "./WindowLegend";
import { rt, rtx } from "../text";

/**
 * bd-sex15q.17 — "Which coach needs me this week" (S8, B9 add): two groups, `needs_me` then `on_track`, each in the
 * server's order (school-list order), no position number, no sort control, never a score. Each row: the coach's label
 * (the server's one string: a name inside the product, a C-code on fixtures), three activity lines (each a Count with
 * its base and window), one "Follow-up". A row opens S9.
 */
/** The coach's initials in a tint circle: the same tint for every coach (no colour is attached to a coach, B21). */
function initials(label: string): string {
  return label.split(/[\s.]+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function CoachRow({ coach, today, floorWeeks, onFollowUp }: { coach: Coach; today: string; floorWeeks: number; onFollowUp: (c: Coach) => void }) {
  const lang = useLang();
  const a = coach.activity;
  return (
    // fix-r5 s2 item 18 (design-qa §S8 d1, qa-rm R7): under 640 px the label, the lines and the button stack; from sm a row.
    // bd-sex15q.47 (R6): a hairline row; the initials circle, the name 16/600, the three lines 13 ink-2, the 44 px
    // secondary. Never a ring, a bar or a colour of its own (DESIGN_SYSTEM §6).
    <li data-testid="coach-row" data-coach={coach.coach_user_id} className="flex flex-col gap-2 border-t border-cp-hairline py-4 first:border-t-0 sm:flex-row sm:items-start sm:gap-3">
      <Link to={rmPaths.coach(coach.coach_user_id)} className="flex min-w-0 flex-1 flex-col rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green sm:flex-row">
        <span className="flex min-w-0 flex-1 items-start gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cp-green-tint text-[14px] font-bold text-cp-green-ink">{initials(coach.coach_label)}</span>
          <span className="flex min-w-0 flex-col gap-0.5 text-[13px] leading-[1.45] text-cp-ink-2">
            <span data-testid="coach-label" data-code="" dir="auto" className="text-[16px] font-semibold leading-snug text-cp-ink">{coach.coach_label}</span>
            <CountLine k="s8.activity.unvisited" count={a.schools_unvisited} vars={{ w: floorWeeks }} none="s8.activity.unvisited.none" />
            <CountLine k="s8.activity.steps" count={a.debriefs_with_step} none="s8.activity.steps.none" />
            <CountLine k="s8.activity.overdue" count={a.checks_overdue} vars={{ date_short: dateShort(today, lang) }} none="s8.activity.overdue.none" />
            {coach.note_open && (
              <span data-testid="note-open" className="text-[12px] text-cp-ink-3">
                {rt("s8.follow_up", lang)}{lang === "ur" ? "، " : " · "}{rt(`s9.notes.status.${coach.note_open.status}` as const, lang)}
              </span>
            )}
          </span>
        </span>
      </Link>
      <Button variant="secondary" size="md" testId="follow-up" onClick={() => onFollowUp(coach)} className="ms-[52px] shrink-0 self-start sm:ms-0">
        <span>{rt("s8.follow_up", lang)}</span>
      </Button>
    </li>
  );
}

function GroupHead({ k, count }: { k: "s8.group.needs_me" | "s8.group.on_track"; count?: Count }) {
  const lang = useLang();
  const green = k === "s8.group.needs_me";
  return (
    <div className="mt-4 flex flex-col">
      <p className={`cp-label text-[12px] font-bold uppercase leading-snug tracking-[0.08em] ${green ? "text-cp-green-ink" : "text-cp-ink-3"}`}>{rt(k, lang)}</p>
      {count && count.d > 0 && <CountLine k="s8.on_track.row" count={count} className="mt-1 text-[13px] text-cp-ink-3" />}
    </div>
  );
}

export function CoachGroups({ home, onFollowUp, testId = "coach-groups", first = false, className }: {
  home: RmHome; onFollowUp: (c: Coach) => void; testId?: string; first?: boolean; className?: string;
}) {
  const lang = useLang();
  const today = todayKarachi(new Date(home.computed_at));
  const fw = home.opening.floor_weeks;
  const row = (c: Coach) => <CoachRow key={c.coach_user_id} coach={c} today={today} floorWeeks={fw} onFollowUp={onFollowUp} />;
  return (
    <Section testId={testId} first={first} className={className} label={rt("s8.needs.title", lang)}
      hint={<>{rt("s8.needs.sub", lang)}<WindowLegend windows={home.windows} ids={windowIds([home.groups, home.on_track_count])} className="inline" sep /></>}>
      <div data-testid="group-needs_me">
        <GroupHead k="s8.group.needs_me" />
        <ul>{home.groups.needs_me.map(row)}</ul>
      </div>
      <div data-testid="group-on_track">
        <GroupHead k="s8.group.on_track" count={home.on_track_count} />
        <ul>{home.groups.on_track.map(row)}</ul>
      </div>
    </Section>
  );
}

/** S8's Friday-circle row (COPY v1.1): "{m} of {c} coaches have a moment · {n} of {d} checks due this week" (A6: m is a Count of coaches, c its base). */
export function CircleCard({ home }: { home: RmHome }) {
  const lang = useLang();
  const m = home.circle.moments;
  return (
    <Link to={rmPaths.circle} data-testid="rm-circle-card" className="flex min-h-[44px] items-center gap-3 py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{rt("s8.circle.title", lang)}</span>
          <span className="text-[13px] leading-[1.45] text-cp-ink-3">
            {/* fix-r5 s3 (qa-rm 171001, B10): no check due this week is words, never "0 of 0 checks" */}
            {home.circle.checks_due.d === 0
              ? rtx("s8.circle.sub.no_checks", lang, {}, [{ n: "m", d: "c", count: m }])
              : rtx("s8.circle.sub", lang, {}, [{ n: "m", d: "c", count: m }, { n: "n", d: "d", count: home.circle.checks_due }])}
            <WindowLegend windows={home.windows} ids={windowIds(home.circle)} className="inline" sep />
          </span>
        </span>
        <ChevronRight size={20} strokeWidth={1.5} className="shrink-0 text-cp-ink-3 rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}
