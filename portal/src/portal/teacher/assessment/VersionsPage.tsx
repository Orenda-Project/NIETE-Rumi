import { Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { portal } from '../../services/api';
import { downloadArtifact, type DownloadResult } from '../../newui/assessment/assessmentApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { FOCUS } from '../ui/styles';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { dayLabel, pkDay, pkToday } from './model';
import { editPath, paperPath } from './paths';
import { findPaper } from './paperCache';
import { Chip, ListCard, LoadState } from './ui';

/* ── Versions (v28 canvas AssessVersions) ────────────────────────────────── */

export function VersionsPage() {
  const C = useCopy(ASSESSMENT);
  const { paperId = '' } = useParams();
  const { toast } = useToast();
  // Only a paper's latest version is in My papers, so a version opens as its file (any version the teacher owns).
  const openVersion = async (id: string, artifact: 'paper' | 'answer_key' = 'paper') => {
    const r: DownloadResult = await downloadArtifact(id, artifact);
    if (r === 'unavailable') toast({ title: C.notAvailable });
    if (r === 'failed') toast({ title: C.couldNotOpen, variant: 'destructive' });
  };
  const [versions, retry] = useLoad(() => portal.getAssessmentVersions(paperId).then((r) => r.versions || []), `versions:${paperId}`);
  const list = dataOf(versions) ?? [];
  const today = pkToday();
  // A board-pattern paper (its row in My papers says so): the FDE chip, and each ready version's marking scheme.
  const [row] = useLoad(() => findPaper(paperId), `versions-paper:${paperId}`);
  const fde = !!(dataOf(row) as { pattern?: string | null } | null | undefined)?.pattern;
  // A handle for the QA harness (display:contents, no box) — on a board-pattern paper only, so a plain paper's page
  // is the branch point's, byte for byte.
  const wrapFde = (list: JSX.Element) => (fde ? <div data-testid="versions-list" className="contents">{list}</div> : list);

  return (
    <TeacherPage crumb={C.title} title={C.versions} backTo={paperPath(paperId)} chips={fde ? <Chip tone="indigo">{C.fdeChip}</Chip> : undefined} testId="assessment-versions">
      {versions.status !== 'ok'
        ? <LoadState status={versions.status} onRetry={retry} />
        : list.length === 0
          ? <LoadState status="ok" empty onRetry={retry} />
          : (
            wrapFde(
            <ListCard label={C.versions}>
              {list.map((v, i) => {
                const ready = v.status === 'ready';
                const day = pkDay(v.createdAt);
                const meta = C.join(
                  day ? dayLabel(day, today, C.days) : null,
                  v.questionCount != null ? C.questionsCount(v.questionCount) : null,
                  v.marks != null ? C.marksCount(v.marks) : null,
                );
                const head = (
                  <>
                    <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[16px] font-extrabold', v.latest ? 'bg-[#33374a] text-white' : 'bg-[#f3f4f6] text-[#33374a]')}>
                      {v.version != null ? C.version(v.version) : ''}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-[16px] font-semibold">
                        {v.version != null ? C.versionLong(v.version) : ''}
                        {v.latest && <Chip tone="done">{C.latest}</Chip>}
                        {!v.editedFrom && <Chip>{C.first}</Chip>}
                        {!ready && <Chip tone={v.status === 'failed' ? 'error' : 'warn'}>{v.status === 'failed' ? C.failed : C.writing}</Chip>}
                      </span>
                      <span className="text-[13px] text-[#6b7280]">{meta}</span>
                    </span>
                  </>
                );
                const line = (
                  <div key={v.paperId} className={cn('flex items-center gap-1.5 py-1.5 pe-1.5', i > 0 && 'border-t border-[#f0f1f3]')}>
                    {ready
                      ? <button type="button" onClick={() => openVersion(v.paperId)} className={cn('flex min-h-[72px] min-w-0 flex-1 items-center gap-3 ps-3 text-start', FOCUS)}>{head}</button>
                      : <div className="flex min-h-[72px] min-w-0 flex-1 items-center gap-3 ps-3">{head}</div>}
                    {ready && (
                      <Link to={editPath(v.paperId)} className={cn('flex min-h-[56px] min-w-[64px] items-center justify-center rounded-[14px] bg-[#f3f4f6] px-2.5 text-[15px] font-semibold text-[#33374a]', FOCUS)}>
                        {C.edit}
                      </Link>
                    )}
                  </div>
                );
                if (!(ready && fde)) return line;
                // A board-pattern version: its marking scheme (the key file) right under it.
                return (
                  <Fragment key={v.paperId}>
                    {line}
                    <button type="button" data-testid="version-scheme" onClick={() => openVersion(v.paperId, 'answer_key')}
                      className={cn('flex min-h-[52px] w-full items-center gap-2.5 border-t border-[#f6f7f8] pe-3 ps-[72px] text-start text-[15px] font-semibold text-[#33374a]', FOCUS)}>
                      <ClipboardCheck className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />
                      {C.markingScheme}
                    </button>
                  </Fragment>
                );
              })}
            </ListCard>,
            )
          )}
    </TeacherPage>
  );
}
