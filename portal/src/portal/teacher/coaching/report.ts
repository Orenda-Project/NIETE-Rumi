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
 * Only what the API carries. The hero report's narrative (headline, identity, moments, strength, horizon)
 * is written per render and not stored, so those sections are left out rather than made up; the image she
 * received is one tap away (Download).
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
  const marks = b && b.marks != null ? b.marks : (s.overallScore ?? 0);
  const max = b && b.max != null ? b.max : (s.maxScore ?? 0);
  const coach = s.observation?.observerName?.trim() || null;
  const points = journey.filter((p) => Number.isFinite(p.pct));
  return {
    headline: '',
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
  const at = stage === 'done' ? 5
    : stage === 'report' ? 4
      : stage === 'reflection' ? (answered ? 4 : 3)
        : stage === 'analysing' ? 2
          : 1; // queued, transcribing
  const defs: Array<[string, string | undefined]> = [
    [C.stepReceived, undefined],
    [C.stepListening, undefined],
    [C.stepChecking, undefined],
    [C.stepReflection, C.subReflection],
    [C.stepReport, C.subReport],
  ];
  return defs.map(([label, sub], i) => ({
    label,
    sub,
    nowText: i === 3 ? C.yourTurn : C.now,
    state: i < at ? 'done' : i === at ? 'current' : 'later',
  }));
}
