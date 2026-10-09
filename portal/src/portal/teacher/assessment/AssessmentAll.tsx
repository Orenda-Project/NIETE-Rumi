import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { AssessmentPaper } from '../../services/api';
import { loadGradeSubjects } from '../../lib/gradeSubjects';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { HistoryList, KpiTiles } from '../ui';
import { FOCUS } from '../ui/styles';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { loadPapers } from './api';
import { rememberPapers } from './paperCache';
import { paperGroups } from './papersList';
import { ASSESSMENT_V2_BASE } from './paths';
import { Label, LoadState } from './ui';

/**
 * bd-fmf24g.34 — All papers (Blueprint AssessAll), from Recent papers' See all: the same pattern as All Lesson
 * Plans. The total (the server's count, GET /assessment/papers `total`), a filter by one of her classes (the
 * server's own grade + subject filters), then every ready paper by the day it was ready, newest first, paged
 * (Show more). The papers list has no date filter on the server, so there is no date range here.
 */

type Filter = { grade: number; subject: string } | null;
const filterKey = (f: Filter) => (f ? `${f.grade}|${f.subject}` : 'all');

export function AssessmentAll() {
  const C = useCopy(ASSESSMENT);
  const [combos] = useLoad(() => loadGradeSubjects('assessment'), 'gs:assessment');
  const [filter, setFilter] = useState<Filter>(null);
  const [papers, setPapers] = useState<AssessmentPaper[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'loading' | 'error' | 'ok'>('loading');
  const [reloadTick, setReloadTick] = useState(0);

  // Page 1 replaces the list (a new filter); later pages add to it.
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
    .map((c) => ({ grade: c.grade as number, subject: c.featureKey as string, label: C.gradeSubject(c.grade as number, c.subject) })), [combos, C]);
  const groups = useMemo(() => paperGroups(papers, C), [papers, C]);

  return (
    <TeacherPage feature="assessment" crumb={C.title} title={C.allPapers} backTo={ASSESSMENT_V2_BASE} testId="assessment-all">
      {status === 'ok' ? <KpiTiles items={[{ value: total, label: C.papersTotal, feature: 'assessment' }]} /> : null}

      {filters.length > 0 && (
        <div role="radiogroup" aria-label={C.allPapers} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 pt-2">
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
            groups={groups}
            emptyLabel={C.noPapersYet}
            showMore={papers.length < total}
            onShowMore={() => setPage((n) => n + 1)}
          />
        )}
    </TeacherPage>
  );
}
