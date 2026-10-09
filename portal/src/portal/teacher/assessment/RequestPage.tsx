import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Check, ChevronRight, Download, FileText, FileX2, KeyRound, Loader2, Pencil, Plus, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { portal } from '../../services/api';
import { downloadArtifact, type DownloadResult } from '../../newui/assessment/assessmentApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { HistoryRow } from '../ui';
import { CARD, FOCUS, GRID } from '../ui/styles';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { catalogueOnce, subjectName, useAssessmentSwitches } from './api';
import { failureLabel } from './failure';
import { fromSpec, type AnySpec } from './model';
import { ASSESSMENT_V2_BASE, editPath, newPaperPath, paperPath, requestPath } from './paths';
import { resetPicks, setPicks } from './store';
import { useJobs } from './useJobs';
import { Chip, ListCard, LoadState, OUTLINE, PRIMARY } from './ui';
import { LeaveNote } from '../ui';
import { NOTICES } from '../notices/copy';

/**
 * bd-fmf24g.6 — one paper she asked for (v28 canvas AssessWriting / AssessFailed / AssessReady):
 *
 *   writing  a ring, ~1 min, "You can leave. We'll tell you here." (the shell follows the job; the strip shows it),
 *            My papers / Make another
 *   failed   the bot's reason (its error code, as a label), Try again (the same request again),
 *            Change choices (back to Check and make with her choices), Dismiss
 *   ready    Download, Answer key (when the paper has one), Edit (when editing is on), Make another,
 *            and the paper itself (its page)
 *
 * The job comes from today's tracking (usePaperJobs). If it is not there (another tab, or it was
 * delivered already), GET /assessment/status says where the request got to.
 */

type Seen = { status: 'writing' | 'ready' | 'failed' | 'missing'; paperId?: string | null; errorCode?: string | null };

function useDirectStatus(requestId: string, ask: boolean): Seen | null {
  const [seen, setSeen] = useState<Seen | null>(null);
  useEffect(() => {
    if (!ask) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const res = await portal.getAssessmentStatus(requestId);
        if (!live) return;
        if (res.status === 'ready' && res.paperId) { setSeen({ status: 'ready', paperId: res.paperId }); return; }
        if (res.status === 'failed') { setSeen({ status: 'failed', errorCode: res.errorCode }); return; }
        if (res.status === 'not_found') { setSeen({ status: 'missing' }); return; }
        setSeen({ status: 'writing' });
      } catch {
        if (!live) return;
      }
      timer = setTimeout(poll, 4000);
    };
    poll();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [requestId, ask]);
  return seen;
}

export function RequestPage() {
  const C = useCopy(ASSESSMENT);
  const N = useCopy(NOTICES);
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const switches = useAssessmentSwitches();
  const [cat] = useLoad(catalogueOnce, 'assessment:catalogue');
  const catalogue = dataOf(cat);
  const { jobs, retry, dismiss, retrying } = useJobs();
  const job = jobs.find((j) => j.requestId === requestId) ?? null;
  const direct = useDirectStatus(requestId, !job);
  const seen: Seen | null = job
    ? { status: job.status, paperId: job.paperId, errorCode: job.errorCode }
    : direct;

  const spec = (job?.spec ?? null) as AnySpec | null;
  const name = spec ? subjectName(catalogue, spec.grade, spec.subject) : '';
  const card = spec && (
    <ListCard label={C.newPaper}>
      <HistoryRow
        subject={name}
        grade={spec.grade}
        title={job?.label ?? ''}
        extra={C.questionsCount(spec.questionCount)}
        action="none"
      />
    </ListCard>
  );

  const open = async (artifact: 'paper' | 'answer_key') => {
    if (!seen?.paperId) return;
    const r: DownloadResult = await downloadArtifact(seen.paperId, artifact);
    if (r === 'unavailable') toast({ title: artifact === 'answer_key' ? C.noKey : C.notAvailable });
    if (r === 'failed') toast({ title: C.couldNotOpen, variant: 'destructive' });
  };
  const another = () => { resetPicks(catalogue?.defaultQuestions); navigate(newPaperPath('class')); };

  let title: string = C.writingTitle;
  let body = <LoadState status="loading" onRetry={() => {}} />;
  let dock: JSX.Element | undefined;

  if (seen?.status === 'writing') {
    body = (
      <div className="flex flex-col items-center gap-5 pt-4">
        <div className="relative flex h-[200px] w-[200px] items-center justify-center" role="status" aria-label={C.writing}>
          <span className="absolute inset-0 rounded-full border-[12px] border-[#e3eefc]" />
          <span className="absolute inset-0 rounded-full border-[12px] border-transparent border-e-[#1d6fd8] border-t-[#1d6fd8] motion-safe:animate-spin" />
          <span className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white shadow-[0_1px_3px_rgba(16,24,40,0.1)]">
            <FileText className="h-11 w-11 text-[#1d6fd8]" aria-hidden="true" />
          </span>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Chip tone="warn">{job?.slow ? C.slow : C.aboutAMinute}</Chip>
        </div>
        {/* bd-fmf24g.15 — replaces the "Safe to leave" chip: the app tells her here when it is ready. */}
        <LeaveNote text={N.leave} />
        <div className="w-full">{card}</div>
      </div>
    );
    dock = (
      <div className="flex w-full flex-col gap-2.5">
        <Link to={ASSESSMENT_V2_BASE} className={cn(OUTLINE, FOCUS)}>{C.myPapers}</Link>
        <button type="button" onClick={another} className={cn(OUTLINE, FOCUS)}>{C.makeAnother}</button>
      </div>
    );
  } else if (seen?.status === 'failed') {
    title = C.notMadeTitle;
    const busy = retrying.has(requestId);
    body = (
      <div className="flex flex-col items-center gap-4 pt-4">
        <span className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[#fee4e2] text-[#c8331f]">
          <FileX2 className="h-[52px] w-[52px]" aria-hidden="true" />
        </span>
        <div role="alert" className={cn('flex w-full items-center gap-3 p-4', CARD)}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fee4e2] text-[#c8331f]">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-[17px] font-semibold">{failureLabel(seen.errorCode, C)}</span>
        </div>
        <div className="w-full">{card}</div>
      </div>
    );
    dock = (
      <div className="flex w-full flex-col gap-2.5">
        <button
          type="button"
          disabled={!job || busy}
          onClick={async () => {
            const res = await retry(requestId);
            if (res && 'job' in res) navigate(requestPath(res.job.requestId), { replace: true });
            else if (res && 'error' in res) toast({ title: C.couldNotStart, description: res.error, variant: 'destructive' });
          }}
          className={cn(job && !busy ? PRIMARY : OUTLINE, FOCUS)}
        >
          {busy ? <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" /> : <RotateCcw className="h-5 w-5" aria-hidden="true" />}
          {C.tryAgain}
        </button>
        {spec && (
          <button
            type="button"
            onClick={() => { setPicks(fromSpec(spec, name || null)); navigate(newPaperPath('check')); }}
            className={cn(OUTLINE, FOCUS)}
          >
            {C.changeChoices}
          </button>
        )}
        <button type="button" onClick={() => { dismiss(requestId); navigate(ASSESSMENT_V2_BASE, { replace: true }); }} className={cn(OUTLINE, FOCUS)}>
          {C.dismiss}
        </button>
      </div>
    );
  } else if (seen?.status === 'ready' && seen.paperId) {
    title = C.readyTitle;
    const paperId = seen.paperId;
    body = (
      <div className="flex flex-col items-center gap-4 pt-2">
        <span className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[#eaf6ef] text-[#2f7a52]">
          <Check className="h-14 w-14" strokeWidth={2.4} aria-hidden="true" />
        </span>
        <div className="flex flex-wrap justify-center gap-2">
          <Chip tone="done">{C.ready}</Chip>
          {spec && <Chip>{C.questionsCount(spec.questionCount)}</Chip>}
          <Chip>{C.withKey}</Chip>
        </div>
        {/* bd-fmf24g.16 — the card IS the row (no padding, overflow-hidden), so the row's lead column sits flush
            with the card's start edge and the card's rounded corners clip it. */}
        <Link to={paperPath(paperId)} className={cn('flex min-h-[76px] w-full items-stretch gap-3 overflow-hidden pe-3', CARD, FOCUS)}>
          <span className="flex min-w-0 flex-1 items-center">
            {spec
              ? <HistoryRow subject={name} grade={spec.grade} title={job?.label ?? ''} extra={C.open} action="none" />
              : <span className="ps-4 text-[16px] font-semibold">{C.open}</span>}
          </span>
          <ChevronRight className="h-6 w-6 shrink-0 self-center text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
        </Link>
        <div className={cn(GRID, 'w-full grid-cols-3 gap-2.5')}>
          <button type="button" onClick={() => open('answer_key')} className={cn('flex min-h-[96px] flex-col items-center justify-center gap-2 p-2 text-[14px] font-semibold', CARD, FOCUS)}>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f3f4f6] text-[#33374a]"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
            {C.answerKey}
          </button>
          {switches?.editing ? (
            <Link to={editPath(paperId)} className={cn('flex min-h-[96px] flex-col items-center justify-center gap-2 p-2 text-[14px] font-semibold', CARD, FOCUS)}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f3f4f6] text-[#33374a]"><Pencil className="h-5 w-5" aria-hidden="true" /></span>
              {C.edit}
            </Link>
          ) : <span aria-hidden="true" />}
          <button type="button" onClick={another} className={cn('flex min-h-[96px] flex-col items-center justify-center gap-2 p-2 text-[14px] font-semibold', CARD, FOCUS)}>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f3f4f6] text-[#33374a]"><Plus className="h-5 w-5" aria-hidden="true" /></span>
            {C.makeAnother}
          </button>
        </div>
      </div>
    );
    dock = (
      <button type="button" onClick={() => open('paper')} className={cn(PRIMARY, FOCUS)}>
        <Download className="h-5 w-5" aria-hidden="true" />
        {C.download}
      </button>
    );
  } else if (seen?.status === 'missing') {
    title = C.notFoundTitle;
    body = <LoadState status="ok" empty emptyLabel={C.notFoundTitle} onRetry={() => {}} />;
  }

  return (
    <TeacherPage crumb={C.title} title={title} backTo={ASSESSMENT_V2_BASE} dock={dock} testId="assessment-request">
      {body}
    </TeacherPage>
  );
}
