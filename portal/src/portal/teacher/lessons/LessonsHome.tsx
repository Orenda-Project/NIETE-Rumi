import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { loadGradeSubjects, type GradeSubject } from '../../lib/gradeSubjects';
import { loadRecentLessonPlans } from '../../lib/recentLessonPlans';
import { lessonPlans } from '../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { teacherPath } from '../routes';
import { GradeSubjectPicker, GradeSubjectSelector, HistoryList, type GradeSubjectValue } from '../ui';
import { FOCUS } from '../ui/styles';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';
import TeacherPage from '../TeacherPage';
import { LESSONS_ALL, lessonsUrl } from './paths';
import { recentGroups } from './recent';

/**
 * bd-fmf24g.3 — the teacher v2 Lesson Plans main page (v28 canvas Lessons).
 *
 *   Select your class      her classes that HAVE lesson plans (GET /me/grade-subjects?feature=lessons,
 *                          `available` only) in the kit's picker; a pick goes straight to that subject's
 *                          chapters. No class with plans: no picker, no "or".
 *   Any grade or subject   the kit's selector; Open (off until both) → that subject's chapters, its key
 *                          read from the catalogue (lessonPlansApi.subjects).
 *   Recent Lesson Plans    collapsed by default: her recent plans (lib/recentLessonPlans — opened here or
 *                          received on WhatsApp, every grade, plus 6–12 plans she asked for) by Pakistan
 *                          day; each row reopens its plan by key (OpenPlanPage).
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function LessonsHomePage() {
  const C = useCopy(LESSONS);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [combos] = useLoad(() => loadGradeSubjects('lessons'), 'gs:lessons');
  const [recent] = useLoad(() => loadRecentLessonPlans(), 'recent');
  const [picked, setPicked] = useState<GradeSubjectValue | null>(null);
  const [busy, setBusy] = useState(false);

  // Only her classes the lesson-plan catalogue has: a class with none would be a dead end.
  const mine = useMemo(
    () => (dataOf(combos) ?? []).filter((c): c is GradeSubject & { grade: number; featureKey: string } =>
      c.available === true && c.grade != null && !!c.featureKey),
    [combos],
  );
  const toChapters = (v: { grade: number; subject: string }) => {
    const c = mine.find((x) => x.grade === v.grade && x.subject === v.subject);
    return c ? lessonsUrl('chapters', { grade: c.grade, subject: c.featureKey, key: c.subjectKey }) : teacherPath('lessons');
  };

  const openPicked = async () => {
    if (!picked?.subject) return;
    setBusy(true);
    try {
      const subjects = await lessonPlans.subjects(picked.grade);
      const want = norm(picked.subject);
      const s = subjects.find((x) => norm(x.name) === want || norm(x.key) === want);
      if (s) navigate(lessonsUrl('chapters', { grade: picked.grade, subject: s.key }));
      else toast({ title: C.notAvailable });
    } catch {
      toast({ title: C.couldNotOpen, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => recentGroups(dataOf(recent) ?? [], undefined, C), [recent, C]);
  const ready = !!picked?.subject && !busy;

  return (
    <TeacherPage feature="lessons" crumb={C.home} title={C.title} backTo={teacherPath('home')}>
      {mine.length ? (
        <>
          <GradeSubjectPicker label={C.selectClass} combos={mine} allowOther={false} to={toChapters} />
          <div role="separator" aria-label={C.or} className="mx-2 my-1 flex items-center gap-3 text-[13px] font-semibold text-[#9ca3af]">
            <i className="h-px flex-1 bg-[#e5e7eb]" />{C.or}<i className="h-px flex-1 bg-[#e5e7eb]" />
          </div>
        </>
      ) : null}
      <h2 className="mx-1 text-[20px] font-light text-[#1d2025]">{C.anyGradeOrSubject}</h2>
      <GradeSubjectSelector feature="lessons" value={picked} onChange={setPicked} />
      <button
        type="button"
        disabled={!ready}
        onClick={() => { void openPicked(); }}
        className={cn(
          'flex min-h-[56px] items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold',
          ready ? 'bg-[#33374a] text-white' : 'bg-[#d1d5db] text-[#6b7280]',
          FOCUS,
        )}
      >
        {C.open}
        <ChevronRight className="h-5 w-5 rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
      </button>
      <div className="mt-3.5">
        <HistoryList
          heading={C.recent}
          collapsible
          defaultOpen={false}
          groups={groups}
          showMore={false}
          seeAllTo={LESSONS_ALL}
          emptyLabel={C.noLessonPlansYet}
        />
      </div>
    </TeacherPage>
  );
}
