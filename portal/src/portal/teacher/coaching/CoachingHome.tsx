import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { acceptFor, checkFile } from '../../lib/coachingUpload';
import { loadGradeSubjects, type GradeSubject } from '../../lib/gradeSubjects';
import { handOffRecording } from '../../lib/lessonHandoff';
import { useRecordingSession } from '../../lib/recordingSession';
import { getRecentPlans, planChips, pickOf } from '../../newui/coaching/coachingApi';
import { PlanSheet } from '../../newui/coaching/PlanSheet';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { GradeSubjectPicker, HistoryList, type GradeSubjectPair } from '../ui';
import { FOCUS } from '../ui/styles';
import { lessonGroups, loadDcHistory } from './api';
import { COACHING_V2_COPY as C } from './copy';
import { holdDraft, planKeyOf, readPrefill, type DraftPlan } from './draft';
import { PhotoGrid, PlanPicker, SectionHeading } from './parts';
import { COACHING_SEND } from './paths';

/**
 * bd-fmf24g.4 — the teacher v2 Digital Coaching page (v28 canvas Coaching): one page to send a lesson.
 *
 *   Your class       her own grade·subject classes only (GET /me/grade-subjects, a grade required — the
 *                    analysis needs one), the first chosen; opened from a lesson plan, that class.
 *   Lesson plan      optional: her recent plans, a photo of her own plan, or the library (today's plan
 *                    sheet); opened from a lesson plan, that plan, named from her recent plans.
 *   Photos           one grid (board work, charts, the classroom), at most 3, No faces.
 *   Start recording  / Upload recording — off until a class; both hand the plan and photos to the send
 *                    page (draft.ts), which records or takes the file and sends exactly those.
 *   Recent DC Observations   collapsed; her Digital Coach lessons (GET /teacher/coaching/history).
 */

const RECENT_COUNT = 5;

export function CoachingHomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useRecordingSession();
  const prefill = useMemo(() => readPrefill(location.search), [location.search]);

  const [combosLoad] = useLoad(() => loadGradeSubjects(), 'gs:coaching');
  const [recentPlans] = useLoad(() => getRecentPlans(20), 'dc:recent-plans');
  const [history] = useLoad(() => loadDcHistory({ range: 'all' }), 'dc:history');

  // A class here is a grade AND a subject: the analysis needs the grade.
  const mine = useMemo(
    () => (dataOf(combosLoad) ?? []).filter((c): c is GradeSubject & { grade: number } => c.grade != null),
    [combosLoad],
  );

  const [combo, setCombo] = useState<GradeSubjectPair | null>(null);
  const [plan, setPlan] = useState<DraftPlan | null>(null);
  const [planProblem, setPlanProblem] = useState<'not_a_plan' | null>(null);
  const [planSheet, setPlanSheet] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const audioInput = useRef<HTMLInputElement>(null);

  // Her class: the one a lesson plan sent her with, else her first.
  useEffect(() => {
    if (combo || !mine.length) return;
    const fromPlan = prefill.grade != null
      ? mine.find((c) => c.grade === prefill.grade && (!prefill.subjectKey || c.subjectKey === prefill.subjectKey))
      : null;
    const first = fromPlan || mine[0];
    setCombo({ grade: first.grade, subject: first.subject });
  }, [mine, prefill, combo]);

  // The plan a lesson plan sent her with, named from her recent plans (the viewer just opened it).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !prefill.pick || recentPlans.status === 'loading' || recentPlans.status === 'idle') return;
    prefilled.current = true;
    const key = planKeyOf(prefill.pick);
    const known = (dataOf(recentPlans) ?? []).find((p) => p.planKey === key);
    setPlan({
      kind: 'library',
      pick: known ? pickOf(known) : prefill.pick,
      title: known?.title || C.planFallback,
      chips: known ? planChips(known) : [],
    });
  }, [prefill, recentPlans]);

  const ready = !!combo;
  const go = (start: 'record' | 'file') => {
    holdDraft({ combo, plan, photos });
    navigate(COACHING_SEND, { state: session?.active ? null : { start } });
  };
  const pickAudio = (file: File | undefined) => {
    if (!file) return;
    handOffRecording(file);
    go('file');
  };

  const groups = useMemo(() => lessonGroups((dataOf(history)?.items ?? []).slice(0, RECENT_COUNT)), [history]);

  return (
    <TeacherPage feature="coaching" title={C.title} crumb={C.home} backTo={teacherPath("home")} testId="dc-home">
      <SectionHeading>{C.yourClass}</SectionHeading>
      {mine.length ? (
        <GradeSubjectPicker label={C.selectClass} combos={mine} allowOther={false} value={combo} onChange={setCombo} />
      ) : null}

      <SectionHeading chip={C.optional}>{C.lessonPlan}</SectionHeading>
      <PlanPicker plan={plan} disabled={!ready} onOpen={() => { setPlanProblem(null); setPlanSheet(true); }} />

      <SectionHeading chip={C.noFaces}>{C.photos}</SectionHeading>
      <p className="mx-1 -mt-1 truncate text-[14px] text-[#6b7280]">{C.photosHint}</p>
      <PhotoGrid photos={photos} onChange={setPhotos} testId="dc-photos-input" />

      <div className="mt-3.5 flex flex-col gap-2.5">
        <button
          type="button"
          disabled={!ready}
          onClick={() => go('record')}
          className={cn(
            'flex h-14 items-center justify-center gap-2.5 rounded-2xl border-[1.5px] text-[16px] font-semibold',
            ready ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-[#e5e7eb] text-[#6b7280]',
            FOCUS,
          )}
        >
          <i aria-hidden="true" className={cn('h-3 w-3 rounded-full', ready ? 'bg-[#ff4d3d] shadow-[0_0_0_4px_rgba(255,77,61,0.3)]' : 'bg-[#9ca3af]')} />
          {C.startRecording}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => audioInput.current?.click()}
          className={cn(
            'flex h-14 items-center justify-center gap-2.5 rounded-2xl border-[1.5px] text-[16px] font-semibold',
            ready ? 'border-[#c7cad6] bg-white text-[#33374a]' : 'border-[#e5e7eb] bg-[#e5e7eb] text-[#6b7280]',
            FOCUS,
          )}
        >
          <Upload className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          {C.uploadRecording}
        </button>
        <input
          ref={audioInput}
          hidden
          type="file"
          data-testid="dc-audio-input"
          accept={acceptFor('audio')}
          onChange={(e) => { pickAudio(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>

      <div className="mt-3">
        <HistoryList
          heading={C.recent}
          collapsible
          defaultOpen={false}
          groups={groups}
          showMore={false}
          emptyLabel={C.noneYet}
        />
      </div>

      <PlanSheet
        open={planSheet}
        onClose={() => setPlanSheet(false)}
        onPick={(p) => { setPlan({ kind: 'library', ...p }); setPlanSheet(false); }}
        onLibrary={() => { setPlanSheet(false); navigate(teacherPath('lessons')); }}
        onFile={(file, asPhoto) => {
          setPlanProblem(null);
          if (!file) return false;
          if (checkFile(file, 'lesson_plan')) { setPlanProblem('not_a_plan'); return false; }
          setPlan({ kind: 'file', file, asPhoto });
          return true;
        }}
        problem={planProblem}
      />
    </TeacherPage>
  );
}
