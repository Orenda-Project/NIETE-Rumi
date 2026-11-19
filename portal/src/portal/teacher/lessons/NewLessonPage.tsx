import { useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { FlnBand } from '../../fln/FlnBand';
import { OWN } from './own/copy';
import { OWN_PICK, OWN_START, ownUrl } from './own/state';
import { useLpOwnGoalStart } from './own/goalApi';
import { GOAL } from './own/goalCopy';
import { OwnStartChoice } from './own/OwnStartChoice';

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
  const O = useCopy(OWN);
  // bd-snkn32.25 — from the main page's Make my own card: same picker, every pick carries pick=own on to the chapters.
  const query = new URLSearchParams(useLocation().search);
  const own = query.get('pick') === OWN_PICK ? OWN_PICK : undefined;
  // bd-snkn32.58.1 (queue #155 A) — goal switch on: own mode opens on two equal starts; `start=goal` picks only her
  // class and goes to the goal step (no chapter); `start=book` is today's flow. Switch off: today's picker, unchanged.
  const G = useCopy(GOAL);
  const goalOn = useLpOwnGoalStart();
  const start = own && goalOn === true ? query.get('start') : null;
  const choosing = !!own && goalOn === true && start !== 'book' && start !== 'goal';
  const toGoal = (grade: number, subject: string) => ownUrl({ grade, subject, step: 'goal', goal: { kind: null, text: '' } });
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
    if (pick.mine && c && c.grade != null && start === 'goal') return toGoal(c.grade, c.featureKey);
    return pick.mine && c && c.grade != null ? lessonsUrl('chapters', { grade: c.grade, subject: c.featureKey, key: c.subjectKey, pick: own }) : undefined;
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
      if (s) navigate(start === 'goal' ? toGoal(v.grade, s.key) : lessonsUrl('chapters', { grade: v.grade, subject: s.key, pick: own }));
      else toast({ title: C.notAvailable });
    } catch {
      toast({ title: C.couldNotOpen, variant: 'destructive' });
    } finally {
      busy.current = false;
    }
  };

  return (
    <TeacherPage crumb={own ? O.makeMyOwn : C.newLessonPlan} title={choosing ? G.startTitle : C.gradeAndSubject} backTo={start ? OWN_START : LESSONS_HOME} testId="lessons-new">
      {own ? null : <Steps n={1} />}
      {choosing ? <OwnStartChoice /> : own && goalOn === null ? <div className="h-[240px] rounded-2xl bg-[#f0f1f3] motion-safe:animate-pulse" aria-hidden /> : (<>
      <ClassPicker
        label={C.selectGradeSubject}
        feature="lessons"
        combos={mine}
        subjectsByGrade={byGrade}
        to={toChapters}
        onChange={(v, pick) => { void openOther(v, pick); }}
      />
      <FlnBand />
      </>)}
    </TeacherPage>
  );
}
