import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, CircleAlert, Download, Hourglass, KeyRound, Loader2, Plus, RotateCcw } from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import { portal, type AssessmentPaper } from '../../services/api';
import { ASSESSMENT_COPY } from '../copy';
import { InnerBar } from '../InnerBar';
import { Chip } from '../Chip';
import { BottomActions, BottomButton } from '../BottomButton';
import { Hero } from '../Hero';
import {
  POLL_INTERVAL_MS, POLL_TIMEOUT_MS, downloadArtifact, failureLabel, subjectIcon, useAssessmentGate,
  type DownloadResult, type RequestState,
} from './assessmentApi';

/**
 * bd-5rz1v.13 — /portal/assessment/request/:requestId, the page after Make assessment
 * (deep-screens.html, Assessment 2 "Writing" and 3 "Ready"). An inner page: the light bar,
 * crumb Assessment, the subject and chapter as its title.
 *
 *   writing  a Hero ring with the time so far and "Writing…"; chips Grade · Subject · n Q.
 *            Asks GET /assessment/status at once and every 4 s, as AssessmentGeneratorPanel
 *            did: queued and generating are ordinary answers, a request that fails on the way
 *            is a blip (the job runs on the server regardless), and after 5 minutes it stops
 *            asking and says "Still writing" with her list one tap away.
 *   ready    a green tick, "15 Q" and "30 marks" (her papers list has the marks), then
 *            Download (primary), Answer key and Make another (outline).
 *   failed   "Not made" and the server's code as a short red chip — the old panel's eleven
 *            toasts as labels, no sentences — then Try again (the same paper) and Change choices.
 *
 * Its address carries the request, so a reload keeps waiting on the same paper; what she asked
 * for rides in the history entry's state (lost only to a fresh tab, where the title falls back).
 */

/** The buttons: fixed above the menu on a phone; on a desktop under the Hero, at a readable width. */
function Actions({ children }: { children: ReactNode }) {
  return <div className="md:mx-auto md:w-full md:max-w-[480px]"><BottomActions>{children}</BottomActions></div>;
}

type Phase =
  | { kind: 'writing' }
  | { kind: 'ready'; paperId: string }
  | { kind: 'failed'; label: string }
  | { kind: 'timeout' };

export default function AssessmentRequest() {
  const { requestId = '' } = useParams();
  const gate = useAssessmentGate();
  if (gate === false) return <Navigate to="/portal/assessment" replace />;
  // A new request (Try again) is a new page: its own clock, its own polling.
  return <RequestPage key={requestId} requestId={requestId} gate={gate} />;
}

/** "0:40" */
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function RequestPage({ requestId, gate }: { requestId: string; gate: boolean | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as RequestState | null) ?? null;
  const [startedAt] = useState(() => (state && Number.isFinite(state.startedAt) ? state.startedAt : Date.now()));
  const [phase, setPhase] = useState<Phase>({ kind: 'writing' });
  const [now, setNow] = useState(() => Date.now());
  const [paper, setPaper] = useState<AssessmentPaper | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // ── ask until the paper is made, it fails, or five minutes pass ─────────
  useEffect(() => {
    if (gate !== true) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const res = await portal.getAssessmentStatus(requestId);
        if (!live) return;
        if (res?.status === 'ready' && res.paperId) { setPhase({ kind: 'ready', paperId: res.paperId }); return; }
        if (res?.status === 'failed') { setPhase({ kind: 'failed', label: failureLabel(res.errorCode) }); return; }
        if (res?.status === 'not_found') { setPhase({ kind: 'failed', label: ASSESSMENT_COPY.notFound }); return; }
      } catch {
        // A blip on the way is not an answer: the job runs on the server regardless.
        if (!live) return;
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) { setPhase({ kind: 'timeout' }); return; }
      timer = setTimeout(ask, POLL_INTERVAL_MS);
    };
    void ask();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [gate, requestId, startedAt]);

  // ── the time on the ring, while writing ─────────────────────────────────
  const writing = phase.kind === 'writing';
  useEffect(() => {
    if (!writing) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [writing]);

  // ── once made: its question count and marks, from her papers ────────────
  const readyId = phase.kind === 'ready' ? phase.paperId : null;
  useEffect(() => {
    if (!readyId) return undefined;
    let live = true;
    portal.getAssessmentPapers({ page: 1, page_size: 10 })
      .then((res) => { if (live) setPaper((res?.papers || []).find((p) => p.paper_id === readyId) ?? null); })
      .catch(() => { /* the chips fall back to what she asked for */ });
    return () => { live = false; };
  }, [readyId]);

  const spec = state?.spec ?? null;
  const title = ASSESSMENT_COPY.paperTitle(state?.subjectName, state?.chapterTitle)
    || (paper ? ASSESSMENT_COPY.paperName(paper.subject, paper.chapter_number) : '')
    || ASSESSMENT_COPY.title;

  const download = async (artifact: 'paper' | 'answer_key') => {
    if (!readyId) return;
    setProblem(null);
    const result: DownloadResult = await downloadArtifact(readyId, artifact);
    if (result === 'unavailable') setProblem(artifact === 'answer_key' ? ASSESSMENT_COPY.noKey : ASSESSMENT_COPY.unavailable);
    if (result === 'failed') setProblem(ASSESSMENT_COPY.notOpened);
  };

  const tryAgain = async () => {
    if (!spec || retrying) return;
    setRetrying(true);
    setProblem(null);
    try {
      const res = await portal.generateAssessment(spec);
      if (!res?.success || !res.requestId) { setProblem(ASSESSMENT_COPY.notStarted); return; }
      const next: RequestState = { spec, subjectName: state?.subjectName ?? null, chapterTitle: state?.chapterTitle ?? null, startedAt: Date.now() };
      navigate(`/portal/assessment/request/${encodeURIComponent(res.requestId)}`, { replace: true, state: next });
    } catch {
      setProblem(ASSESSMENT_COPY.notStarted);
    } finally {
      setRetrying(false);
    }
  };

  const back = () => navigate('/portal/assessment');
  const SubjectIcon = spec ? subjectIcon(spec.subject) : undefined;
  const asked = spec ? (
    <>
      <Chip>{ASSESSMENT_COPY.grade(spec.grade)}</Chip>
      {state?.subjectName ? <Chip icon={SubjectIcon}>{state.subjectName}</Chip> : null}
      <Chip>{ASSESSMENT_COPY.q(spec.questionCount)}</Chip>
    </>
  ) : null;
  const problemChip = problem ? <Chip tone="error" icon={CircleAlert}>{problem}</Chip> : null;

  return (
    <PortalLayout ownHeading>
      <InnerBar feature="assessment" crumb={ASSESSMENT_COPY.title} title={title} backTo="/portal/assessment" />
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-[14px] pb-[14px] md:px-10">
        {gate === null ? <Hero title={ASSESSMENT_COPY.loading} icon={Loader2} spinning live /> : null}

        {gate && phase.kind === 'writing' ? (
          <Hero
            title={ASSESSMENT_COPY.writing}
            // About a minute (AssessmentGeneratorPanel): the ring fills over a minute and a half
            // and waits short of full until the paper is there.
            ring={{ value: Math.min(0.95, (now - startedAt) / 90_000), text: clock(now - startedAt) }}
            chips={asked}
            live
          />
        ) : null}

        {gate && phase.kind === 'ready' ? (
          <>
            <Hero
              title={ASSESSMENT_COPY.ready}
              icon={Check}
              tone="done"
              live
              chips={(
                <>
                  {paper?.question_count != null || spec
                    ? <Chip>{ASSESSMENT_COPY.q(paper?.question_count ?? spec?.questionCount)}</Chip>
                    : null}
                  {paper?.total_marks != null ? <Chip>{ASSESSMENT_COPY.marks(paper.total_marks)}</Chip> : null}
                  {problemChip}
                </>
              )}
            />
            <Actions>
              <BottomButton icon={Download} onClick={() => download('paper')}>{ASSESSMENT_COPY.download}</BottomButton>
              <BottomButton tone="outline" icon={KeyRound} onClick={() => download('answer_key')}>{ASSESSMENT_COPY.answerKey}</BottomButton>
              <BottomButton tone="outline" icon={Plus} onClick={back}>{ASSESSMENT_COPY.makeAnother}</BottomButton>
            </Actions>
          </>
        ) : null}

        {gate && phase.kind === 'failed' ? (
          <>
            <Hero
              title={ASSESSMENT_COPY.notMade}
              icon={CircleAlert}
              tone="error"
              live
              chips={(
                <>
                  <Chip tone="error">{phase.label}</Chip>
                  {problemChip}
                </>
              )}
            />
            <Actions>
              {spec ? (
                <BottomButton icon={RotateCcw} disabled={retrying} onClick={tryAgain}>{ASSESSMENT_COPY.retry}</BottomButton>
              ) : null}
              <BottomButton tone="outline" onClick={back}>{ASSESSMENT_COPY.changeChoices}</BottomButton>
            </Actions>
          </>
        ) : null}

        {gate && phase.kind === 'timeout' ? (
          <>
            <Hero
              title={ASSESSMENT_COPY.stillWriting}
              icon={Hourglass}
              tone="waiting"
              live
              chips={<Chip tone="waiting">{ASSESSMENT_COPY.checkLater}</Chip>}
            />
            <Actions>
              <BottomButton to="/portal/assessment/mine">{ASSESSMENT_COPY.mine}</BottomButton>
              <BottomButton tone="outline" icon={Plus} onClick={back}>{ASSESSMENT_COPY.makeAnother}</BottomButton>
            </Actions>
          </>
        ) : null}
      </div>
    </PortalLayout>
  );
}
