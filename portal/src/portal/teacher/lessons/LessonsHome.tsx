import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { loadGradeSubjects, type GradeSubject } from '../../lib/gradeSubjects';
import { loadRecentLessonPlans } from '../../lib/recentLessonPlans';
import { lessonPlans } from '../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { teacherPath } from '../routes';
import { ClassPicker, HistoryList, type ClassPick, type GradeSubjectPair, type SubjectsByGrade } from '../ui';
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
 *                          read from the catalogue (lessonPlansApi.subjects). The grades and subjects on
 *                          offer are the LIVE catalogue (lessonPlansApi.catalogue — grades 1–5 the bot's
 *                          lp_catalog.json ∩ niete_lp_assets, the WhatsApp /lp menu's own read), never a
 *                          list held here (bd-fmf24g.57: a held copy hid grade 1's GK and Islamiat).
 *   Recent Lesson Plans    collapsed by default: her recent plans (lib/recentLessonPlans — opened here or
 *                          received on WhatsApp, every grade, plus 6–12 plans she asked for) by Pakistan
 *                          day; each row reopens its plan by key (OpenPlanPage).
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const NO_SUBJECTS: SubjectsByGrade = {};

export function LessonsHomePage() {
  const C = useCopy(LESSONS);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [combos] = useLoad(() => loadGradeSubjects('lessons'), 'gs:lessons');
  const [recent] = useLoad(() => loadRecentLessonPlans(), 'recent');
  const [cat] = useLoad(() => lessonPlans.catalogue(), 'lp:catalogue');
  const catalogue = dataOf(cat);
  // Names, as the picker shows them; until the catalogue answers only her own classes can be picked.
  const byGrade = useMemo<SubjectsByGrade>(() => (catalogue
    ? Object.fromEntries(Object.entries(catalogue.byGrade).map(([g, list]) => [g, list.map((s) => s.name)]))
    : NO_SUBJECTS), [catalogue]);
  const busy = useRef(false);

  // Only her classes the lesson-plan catalogue has: a class with none would be a dead end.
  const mine = useMemo(
    () => (dataOf(combos) ?? []).filter((c): c is GradeSubject & { grade: number; featureKey: string } =>
      c.available === true && c.grade != null && !!c.featureKey),
    [combos],
  );
  // Hers: straight to its chapters, with the catalogue's own key and the one subject key.
  const toChapters = (_v: GradeSubjectPair, pick: ClassPick) => {
    const c = pick.combo as (GradeSubject & { featureKey: string }) | null;
    return pick.mine && c && c.grade != null ? lessonsUrl('chapters', { grade: c.grade, subject: c.featureKey, key: c.subjectKey }) : undefined;
  };

  // Any other pair: the catalogue's key for it, then its chapters.
  const openOther = async (v: GradeSubjectPair, pick: ClassPick) => {
    if (pick.mine || busy.current) return;
    busy.current = true;
    try {
      const subjects = await lessonPlans.subjects(v.grade);
      // The name as shown first: an Urdu name ("اسلامیات") has no Latin letters, so its norm() is ''
      // and would match the first other Urdu-named book. norm() only for a Latin spelling.
      const want = norm(v.subject);
      const s = subjects.find((x) => x.name === v.subject)
        ?? (want ? subjects.find((x) => norm(x.name) === want || norm(x.key) === want) : undefined);
      if (s) navigate(lessonsUrl('chapters', { grade: v.grade, subject: s.key }));
      else toast({ title: C.notAvailable });
    } catch {
      toast({ title: C.couldNotOpen, variant: 'destructive' });
    } finally {
      busy.current = false;
    }
  };

  const groups = useMemo(() => recentGroups(dataOf(recent) ?? [], undefined, C), [recent, C]);

  return (
    <TeacherPage feature="lessons" crumb={C.home} title={C.title} backTo={teacherPath('home')}>
      <ClassPicker
        label={C.selectGradeSubject}
        feature="lessons"
        combos={mine}
        subjectsByGrade={byGrade}
        to={toChapters}
        onChange={(v, pick) => { void openOther(v, pick); }}
      />
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
