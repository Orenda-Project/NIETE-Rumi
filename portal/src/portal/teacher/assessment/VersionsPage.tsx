import { Link, useParams } from 'react-router-dom';
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
import { Chip, ListCard, LoadState } from './ui';

/* ── Versions (v28 canvas AssessVersions) ────────────────────────────────── */

export function VersionsPage() {
  const C = useCopy(ASSESSMENT);
  const { paperId = '' } = useParams();
  const { toast } = useToast();
  // Only a paper's latest version is in My papers, so a version opens as its file (any version she owns).
  const openVersion = async (id: string) => {
    const r: DownloadResult = await downloadArtifact(id, 'paper');
    if (r === 'unavailable') toast({ title: C.notAvailable });
    if (r === 'failed') toast({ title: C.couldNotOpen, variant: 'destructive' });
  };
  const [versions, retry] = useLoad(() => portal.getAssessmentVersions(paperId).then((r) => r.versions || []), `versions:${paperId}`);
  const list = dataOf(versions) ?? [];
  const today = pkToday();

  return (
    <TeacherPage crumb={C.title} title={C.versions} backTo={paperPath(paperId)} testId="assessment-versions">
      {versions.status !== 'ok'
        ? <LoadState status={versions.status} onRetry={retry} />
        : list.length === 0
          ? <LoadState status="ok" empty onRetry={retry} />
          : (
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
                return (
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
              })}
            </ListCard>
          )}
    </TeacherPage>
  );
}
