import api from '../../services/api';
import type { CoachingStage, SessionDetail } from '../../types/portal';
import { initials } from '../format';
import { dayName, pkDayOf, pkToday } from '../lessons/days';
import { LESSONS_V2_COPY, type LessonsCopy } from '../lessons/copy';
import type { ProgressStep, ReportData } from '../ui';
import { COACHING_V2_COPY, type CoachingCopy } from './copy';

/**
 * bd-fmf24g.4 — the shared report page's data: GET /coaching-session/:id (the report she got, built by the
 * bot: scores, photos, recording, voice note, her answers, the coach's note) and GET
 * /teacher/coaching/:id/journey (#1983), shaped for the kit's ReportBody.
 *
 * Only what the API carries. The hero report's written part (headline, identity, a moment, strength, horizon,
 * each section's "why") is what the bot stored when it rendered her report (bd-fmf24g.10, `reportNarrative`);
 * on a session without it those sections are left out rather than made up. The image she received is one
 * tap away (Download).
 *
 * bd-fmf24g.13.2 — both helpers take the page's words (useCopy(COACHING)) and toReportData its day names
 * (useCopy(LESSONS).days), English by default.
 */

export type JourneyPoint = { date: string; pct: number };

export async function loadJourney(sessionId: string): Promise<JourneyPoint[]> {
  try {
    const { data } = await api.get(`/teacher/coaching/${encodeURIComponent(sessionId)}/journey`);
    return Array.isArray(data?.points) ? data.points : [];
  } catch {
    return []; // the line is a nicety, never the page
  }
}

const dateLabel = (iso: string | null | undefined, days: LessonsCopy['days']): string => {
  const day = pkDayOf(iso ?? null);
  return day ? dayName(day, pkToday(), days) : '';
};

/** The section's letter as the bot sends it (B/C/D/F for FICO); a longer key gives its first letter. */
const codeOf = (key: string, name: string) => (key && key.length <= 2 ? key.toUpperCase() : (name || key || '?').charAt(0).toUpperCase());

export function toReportData(s: SessionDetail, {
  teacher, journey, words: C = COACHING_V2_COPY, days = LESSONS_V2_COPY.days,
}: { teacher: string; journey: JourneyPoint[]; words?: CoachingCopy; days?: LessonsCopy['days'] }): ReportData {
  const b = s.breakdown || null;
  // Never a stand-in zero: no marks means no score is shown (ReportBody leaves the % and the marks out).
  const marks = b && b.marks != null ? b.marks : (s.overallScore ?? null);
  const max = b && b.max != null ? b.max : (s.maxScore ?? null);
  const coach = s.observation?.observerName?.trim() || null;
  const points = journey.filter((p) => Number.isFinite(p.pct));
  const n = s.reportNarrative || null;
  // The hero image shows the FIRST moment only; the page keeps to the image's order.
  const moment = n?.moments?.[0] ?? null;
  return {
    headline: n?.headline ?? '',
    ...(n?.identity ? { identity: n.identity } : {}),
    moment: moment ? { quote: moment.quote, ...(moment.why ? { why: moment.why } : {}) } : null,
    strength: n?.strength ? { title: n.strength.title, ...(n.strength.note ? { note: n.strength.note } : {}) } : null,
    horizon: n?.horizon ? { title: n.horizon.title, ...(n.horizon.note ? { note: n.horizon.note } : {}) } : null,
    marks,
    max,
    teacher,
    topic: s.topic || s.subject || '',
    date: dateLabel(s.date, days),
    sections: (b?.groups ?? []).map((g) => ({
      code: codeOf(g.key, g.name),
      label: g.name,
      score: g.score,
      max: g.max,
      na: !g.max,
      // A section that was not assessed carries the bot's own line; every other one, the narrative's.
      why: (g.notAssessed ? g.why : n?.domainWhys?.[g.domainKey] ?? g.why) || undefined,
    })),
    photos: (s.photoUrls ?? []).map((src) => ({ src, cap: '' })),
    journey: points.length > 1
      ? { points: points.map((p) => p.pct), first: dateLabel(points[0].date, days), last: dateLabel(points[points.length - 1].date, days) }
      : null,
    // A Digital Coach lesson: the one thing to try, from her commitment card. A coach's visit: what they
    // agreed is in the coach's note below.
    tryNext: !s.observation ? (s.prioritizedAction?.action || null) : null,
    debrief: s.observation && (s.observation.companionText || coach)
      ? { heading: C.fromCoach(coach || C.title), initials: coach ? initials(coach) : undefined, note: s.observation.companionText || undefined }
      : null,
  };
}

/** The Digital Coach pipeline's stage as the steps she sees (the bot tells her the same on WhatsApp). */
export function dcSteps(stage: CoachingStage, answered: boolean, C: CoachingCopy = COACHING_V2_COPY): ProgressStep[] {
  // One Analysing step covers queued, transcribing and analysing (operator, 2026-10-02).
  const at = stage === 'done' ? 3
    : stage === 'report' ? 2
      : stage === 'reflection' ? (answered ? 2 : 1)
        : 0;
  const defs: Array<[string, string | undefined]> = [
    [C.analysing, undefined],
    [C.stepReflection, C.subReflection],
    [C.stepReport, C.subReport],
  ];
  return defs.map(([label, sub], i) => ({
    label,
    sub,
    nowText: i === 1 ? C.yourTurn : C.now,
    state: i < at ? 'done' : i === at ? 'current' : 'later',
  }));
}
