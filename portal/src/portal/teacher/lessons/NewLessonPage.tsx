import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { loadGradeSubjects, type GradeSubject } from '../../lib/gradeSubjects';
import { lessonPlans } from '../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { ClassPicker, type ClassPick, type GradeSubjectPair, type SubjectsByGrade } from '../ui';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';
import TeacherPage from '../TeacherPage';
import { LESSONS_HOME, lessonsUrl } from './paths';
import { Steps } from './Steps';

/**
 * bd-fgj73x — step 1 of 3 of a new lesson plan, Grade and subject (Assessment's Class step, the same kit picker).
 * What the picker offers and where a pick goes are the main page's before this change (bd-fmf24g.3), unchanged:
 *
 *   her classes      the ones that HAVE lesson plans (GET /me/grade-subjects?feature=lessons, `available` only),
 *                    starred; a pick links straight to its chapters with the catalogue's key and the one subject key.
 *   any other pair   the LIVE catalogue (lessonPlansApi.catalogue — grades 1–5 lp_catalog.json ∩ niete_lp_assets,
 *                    6–12 the lp612 corpus), never a list held here (bd-fmf24g.57); its chapters by the key
 *                    lessonPlans.subjects gives.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const NO_SUBJECTS: SubjectsByGrade = {};

export function NewLessonPage() {
  const C = useCopy(LESSONS);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [combos] = useLoad(() => loadGradeSubjects('lessons'), 'gs:lessons');
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

  return (
    <TeacherPage crumb={C.newLessonPlan} title={C.gradeAndSubject} backTo={LESSONS_HOME} testId="lessons-new">
      <Steps n={1} />
      <ClassPicker
        label={C.selectGradeSubject}
        feature="lessons"
        combos={mine}
        subjectsByGrade={byGrade}
        to={toChapters}
        onChange={(v, pick) => { void openOther(v, pick); }}
      />
    </TeacherPage>
  );
}
