import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { acceptFor, checkFile, DC_MAX_PHOTOS, readAudioDuration } from '../../lib/coachingUpload';
import { useRecordingSession } from '../../lib/recordingSession';
import { deleteRecording } from '../../lib/recordingStore';
import { getRecentPlans, planChips, pickOf } from '../../newui/coaching/coachingApi';
import { PlanSheet } from '../../newui/coaching/PlanSheet';
import type { Audio } from '../../newui/coaching/useSendFlow';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { HistoryList, RecordUploadPair } from '../ui';
import { useCopy } from '../i18n';
import { LESSONS } from '../lessons/copy';
import { lessonGroups, loadDcHistory } from './api';
import { COACHING } from './copy';
import { holdDraft, peekDraft, planKeyOf, readPrefill, type DraftPlan } from './draft';
import { Action, Dock, PhotoGrid, PlanPicker, RecordingCard, SectionHeading } from './parts';
import { COACHING_ALL, COACHING_SEND } from './paths';

/**
 * bd-fmf24g.4 — the teacher v2 Digital Coaching page (v28 canvas Coaching): one page to send a lesson.
 *
 * bd-fmf24g.76 — the same order as the WhatsApp flow, and NO class (WhatsApp never asks one; the lesson's subject
 * comes from its plan and the analysis, as there):
 *
 *   Record lesson / Upload recording   first. Record opens the recording page (SendPage) and returns here when she
 *                    stops; Upload opens the file picker and attaches in place (a bad file is said, not dropped).
 *   her recording    once there is one: Listen, and Redo / Change file.
 *   Lesson plan      optional: her recent plans, a photo of her own plan, or the library (today's plan sheet);
 *                    opened from a lesson plan, that plan, named from her recent plans.
 *   Photos           one grid (board work, charts, the classroom), at most ten, No faces.
 *   Submit           the page's one action, on once there is a recording. It sends exactly what the page holds.
 *   Recent DC Observations   collapsed; her Digital Coach lessons (GET /teacher/coaching/history).
 *
 * The recording, the plan and the photos are held in memory (draft.ts) so a trip to the recording page, the library
 * or a lesson plan, and Back, finds them as she left them.
 *
 * bd-fmf24g.13.2 — every word in the page's language (useCopy); Recent's chips and days too.
 */

const RECENT_COUNT = 5;

type AudioProblem = 'too_large' | 'not_audio' | null;

export function CoachingHomePage() {
  const C = useCopy(COACHING);
  const { days } = useCopy(LESSONS);
  const navigate = useNavigate();
  const location = useLocation();
  const session = useRecordingSession();
  const prefill = useMemo(() => readPrefill(location.search), [location.search]);

  const [recentPlans] = useLoad(() => getRecentPlans(20), 'dc:recent-plans');
  const [history] = useLoad(() => loadDcHistory({ range: 'all' }), 'dc:history');

  // bd-fmf24g.68: coming BACK here (from the library, from the recording page) she finds her recording, plan and photos as
  // she left them (draft.ts holds them when she goes). Opened any other way, the page starts empty.
  const cameBack = useNavigationType() === 'POP' || !!(location.state as { keep?: boolean } | null)?.keep;
  const [kept] = useState(() => (cameBack ? peekDraft() : null));
  const [audio, setAudio] = useState<Audio | null>(kept?.audio ?? null);
  const [audioProblem, setAudioProblem] = useState<AudioProblem>(null);
  const [plan, setPlan] = useState<DraftPlan | null>(kept?.plan ?? null);
  const [planProblem, setPlanProblem] = useState<'not_a_plan' | null>(null);
  const [planSheet, setPlanSheet] = useState(() => !!(location.state as { openPlan?: boolean } | null)?.openPlan);
  const [photos, setPhotos] = useState<File[]>(kept?.photos ?? []);
  const audioInput = useRef<HTMLInputElement>(null);

  // What the page holds is always the draft, so any way out and back finds it.
  useEffect(() => { holdDraft({ audio, plan, photos }); }, [audio, plan, photos]);

  // The plan a lesson plan sent her with, named from her recent plans (the viewer just opened it).
  const prefilled = useRef(!!kept);
  useEffect(() => {
    if (prefilled.current || !prefill.pick || recentPlans.status === 'loading' || recentPlans.status === 'idle') return;
    prefilled.current = true;
    const key = planKeyOf(prefill.pick);
    const known = (dataOf(recentPlans) ?? []).find((p) => p.planKey === key);
    setPlan({
      kind: 'library',
      pick: known ? pickOf(known) : prefill.pick,
      title: known?.title || C.planFallback,
      chips: known ? planChips(known, C.picker) : [],
    });
  }, [prefill, recentPlans, C]);

  // Record opens the recording page (a lesson already recording is shown there, never a second one).
  const record = () => {
    holdDraft({ audio, plan, photos });
    navigate(COACHING_SEND, { state: session?.active ? null : { start: 'record' } });
  };
  // A recording file: checked here and attached in place. A bad one is said, and the one she had stays.
  const pickAudio = async (file: File | undefined) => {
    setAudioProblem(null);
    if (!file) return;
    const problem = checkFile(file, 'audio');
    if (problem) { setAudioProblem(problem === 'too_large' ? 'too_large' : 'not_audio'); return; }
    const seconds = await readAudioDuration(file);
    setAudio({
      blob: file, filename: file.name, durationMs: seconds != null ? seconds * 1000 : null,
      recordingId: null, source: 'file', size: file.size, startedAt: null,
    });
  };
  // Redo: the phone copy goes and she records or uploads again.
  const redo = async () => {
    const id = audio?.recordingId;
    if (id) { try { await deleteRecording(id); } catch { /* gone */ } }
    setAudio(null);
    setAudioProblem(null);
  };
  const submit = () => {
    holdDraft({ audio, plan, photos });
    navigate(COACHING_SEND, { state: { start: 'submit' } });
  };

  const groups = useMemo(
    () => lessonGroups((dataOf(history)?.items ?? []).slice(0, RECENT_COUNT), undefined, C, days),
    [history, C, days],
  );

  return (
    <TeacherPage
      feature="coaching"
      title={C.title}
      crumb={C.home}
      backTo={teacherPath("home")}
      testId="dc-home"
      dock={audio ? <Dock><Action onClick={submit}>{C.submit}</Action></Dock> : undefined}
    >
      {audio ? (
        <RecordingCard audio={audio} onRedo={() => { void redo(); }} onChangeFile={() => audioInput.current?.click()} />
      ) : (
        <RecordUploadPair
          onRecord={record}
          onUpload={() => audioInput.current?.click()}
          copy={{ startRecording: C.recordTitle, uploadRecording: C.uploadRecording }}
        />
      )}
      <input
        ref={audioInput}
        hidden
        type="file"
        data-testid="dc-audio-input"
        accept={acceptFor('audio')}
        onChange={(e) => { void pickAudio(e.target.files?.[0]); e.target.value = ''; }}
      />
      {audioProblem ? (
        <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{audioProblem === 'too_large' ? C.tooLarge : C.notAudio}</p>
      ) : null}

      {audio ? (
        <>
          <SectionHeading chip={C.optional}>{C.lessonPlan}</SectionHeading>
          <PlanPicker plan={plan} onOpen={() => { setPlanProblem(null); setPlanSheet(true); }} />

          <SectionHeading chip={[C.upToPhotos(DC_MAX_PHOTOS), C.noFaces]}>{C.photos}</SectionHeading>
          <p className="mx-1 -mt-1 truncate text-[14px] text-[#6b7280]">{C.photosHint}</p>
          <PhotoGrid photos={photos} onChange={setPhotos} testId="dc-photos-input" max={DC_MAX_PHOTOS} />
        </>
      ) : null}

      {/* While a recording is being sent off, the page is that one task: Recent is back when she has none on it. */}
      {audio ? null : (
        <div className="mt-3">
          <HistoryList
            heading={C.recent}
            collapsible
            defaultOpen={false}
            groups={groups}
            showMore={false}
            seeAllTo={COACHING_ALL}
            emptyLabel={C.noneYet}
          />
        </div>
      )}

      <PlanSheet
        words={C.picker}
        open={planSheet}
        onClose={() => setPlanSheet(false)}
        onPick={(p) => { setPlan({ kind: 'library', ...p }); setPlanSheet(false); }}
        onLibrary={() => { setPlanSheet(false); holdDraft({ audio, plan, photos }); navigate(teacherPath('lessons')); }}
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
