import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, LayoutList, Plus, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssessmentPaper } from '../../services/api';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { FEATURE_HUE } from '../icons';
import { teacherPath } from '../routes';
import TeacherPage from '../TeacherPage';
import { HistoryList, HistoryRow } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { catalogueOnce, loadPapers, subjectName, useAssessmentSwitches } from './api';
import { paperGroups } from './papersList';
import { rememberPapers } from './paperCache';
import { ASSESSMENT_ALL, newPaperPath, requestPath } from './paths';
import { resetPicks, setPicks } from './store';
import { pkDay, pkToday, questionsOf } from './model';

import { failureLabel } from './failure';
import { useJobs } from './useJobs';
import { Chip, Label, ListCard, LoadState } from './ui';

/** A Being made row's count line: none for a board-pattern job (the pattern fixes its count, sent as 0). */
const countLine = (n: number | null, say: (n: number) => string) => (n != null ? say(n) : undefined);

/**
 * bd-fmf24g.6 — the teacher v2 Assessment main page (v28 canvas Assessment.dc.html):
 *
 *   New paper      the six-step flow (fresh choices each time)
 *   Being made     her papers still being written, and any that failed (Try again / Dismiss on its page),
 *                  from today's job tracking (usePaperJobs, the tab's session)
 *   Recent papers  her latest ready papers (GET /assessment/papers, page 1), by the day each was ready, newest first;
 *                  the ones that landed while she watched carry the New dot. Collapsible, open, with See all
 *                  → All papers (AssessmentAll): the Lesson Plans pattern (bd-fmf24g.34)
 *
 * With the generator off on this deployment (GET /config), Coming soon and nothing else.
 */

export function AssessmentHub() {
  const C = useCopy(ASSESSMENT);
  const switches = useAssessmentSwitches();
  const [cat] = useLoad(catalogueOnce, 'assessment:catalogue');
  const catalogue = dataOf(cat);
  const [papers, setPapers] = useState<AssessmentPaper[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'ok'>('loading');
  const [reloadTick, setReloadTick] = useState(0);
  const [newIds, setNewIds] = useState<string[]>([]);

  const { jobs } = useJobs({
    onReady: (job) => {
      if (job.paperId) setNewIds((ids) => (ids.includes(job.paperId as string) ? ids : [...ids, job.paperId as string]));
      setReloadTick((t) => t + 1);
    },
  });

  // Her latest page of papers; a paper that just landed asks again.
  useEffect(() => {
    let live = true;
    setStatus('loading');
    loadPapers({ page: 1 })
      .then((res) => {
        if (!live) return;
        rememberPapers(res.papers || []);
        setPapers(res.papers || []);
        setStatus('ok');
      })
      .catch(() => { if (live) setStatus('error'); });
    return () => { live = false; };
  }, [reloadTick]);

  const making = jobs.filter((j) => j.status === 'writing' || j.status === 'failed');
  const groups = useMemo(() => paperGroups(papers, C, newIds), [papers, C, newIds]);
  const navigate = useNavigate();

  // The FDE door: only while /assessment/options advertises the board pattern (its flag on the bot). It remembers the
  // last board-pattern paper in the teacher's list, so the repeat journey is one tap to Check.
  const fdeGrade = catalogue?.patternGrades?.[0] ?? null;
  const lastFde = fdeGrade !== null ? papers.find((x) => x.pattern) : undefined;
  // The door asks for "a board pattern"; which one comes with the subject (/assessment/options' patterns), on the pick.
  const fdePicks = (pattern: string | null) => ({ grade: fdeGrade, patternIntent: pattern ?? 'fde', coverBy: 'fde' as const, style: 'fde' as const, pattern });
  const lastDays = (() => {
    const day = pkDay(lastFde?.ready_at);
    return day ? Math.max(0, Math.round((Date.parse(pkToday()) - Date.parse(day)) / 86_400_000)) : null;
  })();
  const door = fdeGrade !== null && (
    <div className={cn('overflow-hidden', CARD)}>
      <Link
        to={newPaperPath('class')}
        data-testid="fde-door"
        onClick={() => { resetPicks(catalogue?.defaultQuestions); setPicks(fdePicks(null)); }}
        className={cn('flex min-h-[112px] items-center gap-4 p-4', FOCUS)}
      >
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
          style={{ background: FEATURE_HUE.assessment.bg, color: FEATURE_HUE.assessment.fg }}
        >
          <LayoutList className="h-[30px] w-[30px]" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <b className="text-[20px] font-semibold leading-tight">{C.fdeDoor}</b>
          <span className="flex flex-wrap gap-1.5">{C.fdeDoorChips.split(' · ').map((c) => <Chip key={c}>{c}</Chip>)}</span>
          {lastFde && lastDays !== null && <span className="text-[14px] text-[#4b5563]">{C.lastMade(lastFde.subject, lastDays)}</span>}
        </span>
        <ChevronRight className="h-6 w-6 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
      </Link>
      {lastFde && (
        <button
          type="button"
          data-testid="fde-door-again"
          onClick={() => {
            resetPicks(catalogue?.defaultQuestions);
            setPicks({ ...fdePicks(lastFde.pattern as string), grade: lastFde.grade ?? fdeGrade, subject: lastFde.subject_key, subjectName: lastFde.subject });
            navigate(newPaperPath('check'));
          }}
          className={cn('flex min-h-[56px] w-full items-center justify-center gap-2 border-t border-[#f0f1f3] text-[16px] font-semibold text-[#33374a]', FOCUS)}
        >
          <RotateCcw className="h-5 w-5" aria-hidden="true" />
          {C.makeAnother}
        </button>
      )}
    </div>
  );

  const page1 = (
    <>
      {door}
      <Link
        to={newPaperPath('class')}
        onClick={() => resetPicks(catalogue?.defaultQuestions)}
        className={cn('flex min-h-[112px] items-center gap-4 p-4', CARD, FOCUS)}
      >
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
          style={{ background: FEATURE_HUE.assessment.bg, color: FEATURE_HUE.assessment.fg }}
        >
          <Plus className="h-[30px] w-[30px]" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <b className="text-[20px] font-semibold leading-tight">{C.newPaper}</b>
          <Chip>{C.withKey}</Chip>
        </span>
        <ChevronRight className="h-6 w-6 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
      </Link>

      {making.length > 0 && (
        <>
          <Label chip={<Chip tone="warn">{making.length}</Chip>}>{C.beingMade}</Label>
          <ListCard label={C.beingMade}>
            {making.map((j, i) => (
              <HistoryRow
                key={j.requestId}
                first={i === 0}
                subject={subjectName(catalogue, j.spec.grade, j.spec.subject)}
                grade={j.spec.grade}
                title={j.label}
                // A board-pattern job carries questionCount 0 (the pattern fixes it): its label says FDE pattern, no count.
                extra={countLine(questionsOf(j.spec, null), C.questionsCount)}
                chip={j.status === 'writing'
                  ? { text: j.slow ? C.slow : C.writing, tone: 'waiting' }
                  : { text: failureLabel(j.errorCode, C), tone: 'error' }}
                to={requestPath(j.requestId)}
              />
            ))}
          </ListCard>
        </>
      )}

      {status !== 'ok'
        ? (
          <>
            <Label>{C.recent}</Label>
            <LoadState status={status} onRetry={() => setReloadTick((t) => t + 1)} />
          </>
        )
        : (
          <HistoryList
            heading={C.recent}
            collapsible
            defaultOpen
            groups={groups}
            showMore={false}
            seeAllTo={ASSESSMENT_ALL}
            emptyLabel={C.noPapersYet}
          />
        )}
    </>
  );

  return (
    <TeacherPage feature="assessment" crumb={C.home} title={C.title} backTo={teacherPath('home')} testId="assessment-hub">
      {switches === null
        ? <LoadState status="loading" onRetry={() => {}} />
        : !switches.generator
          ? <LoadState status="ok" empty emptyLabel={C.comingSoon} onRetry={() => {}} />
          : page1}
    </TeacherPage>
  );
}
