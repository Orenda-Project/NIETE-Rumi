import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssessmentPaper } from '../../services/api';
import { loadGradeSubjects } from '../../lib/gradeSubjects';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { FEATURE_HUE } from '../icons';
import { teacherPath } from '../routes';
import TeacherPage from '../TeacherPage';
import { HistoryList, HistoryRow } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { ASSESSMENT_V2_COPY as C } from './copy';
import { catalogueOnce, loadPapers, subjectName, useAssessmentSwitches } from './api';
import { groupPapersByDay, pkToday } from './model';
import { rememberPapers } from './paperCache';
import { newPaperPath, paperPath, requestPath } from './paths';
import { resetPicks } from './store';
import { failureLabel } from './failure';
import { useJobs } from './useJobs';
import { Chip, Label, ListCard, LoadState } from './ui';

/**
 * bd-fmf24g.6 — the teacher v2 Assessment main page (v28 canvas Assessment.dc.html):
 *
 *   New paper      the six-step flow (fresh choices each time)
 *   Being made     her papers still being written, and any that failed (Try again / Dismiss on its page),
 *                  from today's job tracking (usePaperJobs, the tab's session)
 *   filters        All, then her classes (GET /me/grade-subjects?feature=assessment) → GET /assessment/papers'
 *                  own grade + subject filters
 *   My papers      every ready paper, grouped by the day it was ready, newest first, paged (Show more);
 *                  the ones that landed while she watched carry the New dot
 *
 * With the generator off on this deployment (GET /config), Coming soon and nothing else.
 */

type Filter = { grade: number; subject: string } | null;
const filterKey = (f: Filter) => (f ? `${f.grade}|${f.subject}` : 'all');

export function AssessmentHub() {
  const switches = useAssessmentSwitches();
  const [cat] = useLoad(catalogueOnce, 'assessment:catalogue');
  const catalogue = dataOf(cat);
  const [combos] = useLoad(() => loadGradeSubjects('assessment'), 'gs:assessment');
  const [filter, setFilter] = useState<Filter>(null);
  const [papers, setPapers] = useState<AssessmentPaper[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'loading' | 'error' | 'ok'>('loading');
  const [reloadTick, setReloadTick] = useState(0);
  const [newIds, setNewIds] = useState<string[]>([]);

  const { jobs } = useJobs({
    onReady: (job) => {
      if (job.paperId) setNewIds((ids) => (ids.includes(job.paperId as string) ? ids : [...ids, job.paperId as string]));
      setPage(1);
      setReloadTick((t) => t + 1);
    },
  });

  // Page 1 replaces the list (a new filter, a paper that just landed); later pages add to it.
  useEffect(() => {
    let live = true;
    setStatus((s) => (page === 1 ? 'loading' : s));
    loadPapers({ page, grade: filter?.grade, subject: filter?.subject })
      .then((res) => {
        if (!live) return;
        rememberPapers(res.papers || []);
        setPapers((cur) => (page === 1 ? res.papers || [] : [...cur, ...(res.papers || [])]));
        setTotal(res.total || 0);
        setStatus('ok');
      })
      .catch(() => { if (live) setStatus('error'); });
    return () => { live = false; };
  }, [page, filter, reloadTick]);

  const pick = useCallback((f: Filter) => { setFilter(f); setPage(1); }, []);
  const filters = useMemo(() => (dataOf(combos) ?? [])
    .filter((c) => c.grade !== null && c.available && c.featureKey)
    .map((c) => ({ grade: c.grade as number, subject: c.featureKey as string, label: C.gradeSubject(c.grade as number, c.subject) })), [combos]);

  const making = jobs.filter((j) => j.status === 'writing' || j.status === 'failed');
  const today = pkToday();
  const groups = groupPapersByDay(papers, today).map((g) => ({
    day: g.day,
    items: g.items.map((p) => ({
      id: p.paper_id,
      subject: p.subject,
      grade: p.grade ?? '',
      title: p.chapter_number != null ? C.chapterShort(p.chapter_number) : C.questionsCount(p.question_count ?? 0),
      extra: C.join(
        p.chapter_number != null && p.question_count != null ? C.questionsCount(p.question_count) : null,
        p.total_marks != null ? C.marksCount(p.total_marks) : null,
        p.version != null && p.version > 1 ? C.version(p.version) : null,
      ),
      isNew: newIds.includes(p.paper_id),
      to: paperPath(p.paper_id),
    })),
  }));

  const page1 = (
    <>
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
                extra={C.questionsCount(j.spec.questionCount)}
                chip={j.status === 'writing'
                  ? { text: j.slow ? C.slow : C.writing, tone: 'waiting' }
                  : { text: failureLabel(j.errorCode), tone: 'error' }}
                to={requestPath(j.requestId)}
              />
            ))}
          </ListCard>
        </>
      )}

      {filters.length > 0 && (
        <div role="radiogroup" aria-label={C.myPapers} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 pt-2">
          {[{ key: 'all', label: C.all, value: null as Filter }, ...filters.map((f) => ({ key: filterKey(f), label: f.label, value: f as Filter }))].map((o) => {
            const on = filterKey(filter) === o.key;
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(o.value)}
                className={cn(
                  'flex min-h-[56px] shrink-0 items-center whitespace-nowrap rounded-full border-[1.5px] px-4 text-[15px] font-semibold',
                  on ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#d1d5db] bg-white',
                  FOCUS,
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {status !== 'ok' && page === 1
        ? (
          <>
            <Label>{C.myPapers}</Label>
            <LoadState status={status} onRetry={() => setReloadTick((t) => t + 1)} />
          </>
        )
        : (
          <HistoryList
            heading={C.myPapers}
            groups={groups}
            emptyLabel={C.noPapersYet}
            showMore={papers.length < total}
            onShowMore={() => setPage((n) => n + 1)}
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
