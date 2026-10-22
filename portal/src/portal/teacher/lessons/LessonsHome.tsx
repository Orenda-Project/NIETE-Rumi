import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { loadRecentLessonPlans } from '../../lib/recentLessonPlans';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { FEATURE_HUE } from '../icons';
import { teacherPath } from '../routes';
import { HistoryList, HistoryRow } from '../ui';
import { CARD, FOCUS, LIST_CARD } from '../ui/styles';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';
import TeacherPage from '../TeacherPage';
import { LESSONS_ALL, LESSONS_NEW } from './paths';
import { recentGroups } from './recent';
import { useLessonsLeader } from './audience';
import { FlnBand } from '../../fln/FlnBand';

/**
 * bd-fmf24g.3 — the teacher v2 Lesson Plans main page. bd-fgj73x — in the Assessment flow (AssessmentHub), the
 * pattern every teacher feature takes:
 *
 *   New lesson plan        the + card → step 1 of 3, Grade and subject (NewLessonPage), then Chapter, then Lesson.
 *   Being made             only while a grades 6–12 plan she asked for is still being written (lib/recentLessonPlans
 *                          tag 'preparing'); each row opens it (Preparing until it is written).
 *   Recent Lesson Plans    open, with See all: her recent plans (opened here or received on WhatsApp, every grade, plus
 *                          6–12 plans she asked for) by Pakistan day; each row reopens its plan by key (OpenPlanPage).
 *
 * bd-4joiqz — for a LEADER (lessons/audience.ts) this is their Lesson Plans tab: a top-level page (no Back into the
 * teacher's Home, which turns a leader away), New lesson plan, and the Reading Hour & Numeracy band. No Being made and
 * no Recent: those are a teacher's own history, and they are not even asked for.
 */

export function LessonsHomePage() {
  const C = useCopy(LESSONS);
  const leader = useLessonsLeader();
  const [recent] = useLoad(leader ? null : () => loadRecentLessonPlans(), leader ? 'recent:none' : 'recent');
  const plans = useMemo(() => dataOf(recent) ?? [], [recent]);

  const making = useMemo(
    () => recentGroups(plans.filter((p) => p.tag === 'preparing'), undefined, C).flatMap((g) => g.items),
    [plans, C],
  );
  const groups = useMemo(() => recentGroups(plans.filter((p) => p.tag !== 'preparing'), undefined, C), [plans, C]);

  return (
    <TeacherPage feature="lessons" crumb={leader ? undefined : C.home} title={C.title} backTo={leader ? undefined : teacherPath('home')}>
      <Link to={LESSONS_NEW} className={cn('flex min-h-[112px] items-center gap-4 p-4', CARD, FOCUS)}>
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
          style={{ background: FEATURE_HUE.lessons.bg, color: FEATURE_HUE.lessons.fg }}
        >
          <Plus className="h-[30px] w-[30px]" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <b className="text-[20px] font-semibold leading-tight">{C.newLessonPlan}</b>
          <span className="inline-flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-full bg-[#e5e7eb] px-2.5 text-[12px] font-semibold text-[#374151]">
            {C.allGrades}
          </span>
        </span>
        <ChevronRight className="h-6 w-6 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
      </Link>

      {leader ? <FlnBand /> : null}

      {!leader && making.length > 0 && (
        <>
          <h2 className="mx-1 mt-3 flex items-center gap-2 text-[20px] font-light">
            {C.preparing}
            <span className="inline-flex h-[26px] shrink-0 items-center rounded-full bg-[#fef3c7] px-2.5 text-[12px] font-semibold text-[#b45309]">
              {making.length}
            </span>
          </h2>
          <section aria-label={C.preparing} className={LIST_CARD}>
            {making.map(({ id, ...row }, i) => <HistoryRow key={id ?? i} first={i === 0} {...row} />)}
          </section>
        </>
      )}

      {leader ? null : (
        <div className="mt-3.5">
          <HistoryList
            heading={C.recent}
            collapsible
            defaultOpen
            groups={groups}
            showMore={false}
            seeAllTo={LESSONS_ALL}
            emptyLabel={C.noLessonPlansYet}
          />
        </div>
      )}
    </TeacherPage>
  );
}
