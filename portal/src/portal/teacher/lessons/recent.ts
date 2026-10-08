import type { RecentLessonPlan } from '../../lib/recentLessonPlans';
import type { ChipData, HistoryGroup } from '../ui';
import { LESSONS_V2_COPY as C } from './copy';
import { dayName, pkDayOf, pkToday } from './days';
import { openUrl } from './paths';

/**
 * bd-fmf24g.3 — Recent Lesson Plans on the main page: her recent plans (lib/recentLessonPlans) as the
 * kit's HistoryList groups, by Pakistan day, each row reopening its plan by key.
 */

/** How she last had a recent plan, as the row's chip. */
function chipFor(p: RecentLessonPlan): ChipData {
  if (p.tag === 'preparing') return { text: C.preparing, tone: 'waiting' };
  if (p.tag === 'ready') return { text: C.ready, tone: 'done' };
  return p.tag === 'whatsapp' ? { text: C.all.whatsapp, tone: 'done' } : { text: C.all.opened, tone: 'info' };
}

/** Her recent plans as HistoryList groups, by Pakistan day, in the list's own order. */
export function recentGroups(plans: RecentLessonPlan[], today: string = pkToday()): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const p of plans) {
    const day = pkDayOf(p.at);
    const label = day ? dayName(day, today) : C.recent;
    let g = groups[groups.length - 1];
    if (!g || g.day !== label) { g = { day: label, items: [] }; groups.push(g); }
    const o = p.open;
    g.items.push({
      id: p.key,
      subject: p.subject ?? '',
      grade: p.grade ?? '',
      title: p.title || C.planFallback,
      extra: p.dayLabel ?? p.chapterTitle ?? undefined,
      chip: chipFor(p),
      to: openUrl(o.lane === 'k5'
        ? { plan: `k5:${o.lessonId}`, title: p.title, grade: p.grade }
        : { plan: `g612:${o.segmentId}`, lang: o.lang, title: p.title, grade: p.grade }),
    });
  }
  return groups;
}

