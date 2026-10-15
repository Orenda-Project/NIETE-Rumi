import { Link, useParams } from 'react-router-dom';
import { ChevronRight, ClipboardCheck, Download, History, KeyRound, Pencil } from 'lucide-react';
import { browserEnv } from '@/lib/runtime';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { portal } from '../../services/api';
import { downloadArtifact, type DownloadResult } from '../../newui/assessment/assessmentApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { FOCUS } from '../ui/styles';
import { ShareActions } from '../ui/ShareActions';
import { shareToWhatsApp, useShareAvailable } from '../share/api';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { useAssessmentSwitches } from './api';
import { dayLabel, pkDay, pkToday } from './model';
import { findPaper } from './paperCache';
import { ASSESSMENT_V2_BASE, editPath, paperPath, versionsPath } from './paths';
import { HistoryRow } from '../ui';
import { PaperBody } from './PaperBody';
import { Chip, ListCard, LoadState } from './ui';
import { SkeletonList } from '../../components/Skeleton';

/**
 * bd-fmf24g.6 — one paper (v28 canvas AssessPaper): its class, chapter, questions, marks and version,
 * then, in the dock, ShareActions (Send on WhatsApp as a template, grey "Not available yet" until one is configured; Open in
 * another app), and in the list Download, Answer key (only when the paper has one — has_answer_key) and, when editing is
 * on (GET /config assessmentEditing), Edit and Versions.
 */

/** Board-pattern papers are not edited in the app for now (cut A, 15 Oct 2026): the editor cannot yet keep the board's shape. */
export const FDE_EDITING = false;

function ActionRow({ to, onPress, icon, label, first }: {
  to?: string; onPress?: () => void; icon: JSX.Element; label: string; first?: boolean;
}) {
  const inner = (
    <>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]">{icon}</span>
      <span className="flex-1 text-[16px] font-semibold">{label}</span>
      <ChevronRight className="h-[22px] w-[22px] shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
    </>
  );
  const cls = cn('flex min-h-[68px] w-full items-center gap-3.5 px-3 text-start', !first && 'border-t border-[#f0f1f3]', FOCUS);
  return to
    ? <Link to={to} className={cls}>{inner}</Link>
    : <button type="button" onClick={onPress} className={cls}>{inner}</button>;
}

export function PaperPage() {
  const C = useCopy(ASSESSMENT);
  const { paperId = '' } = useParams();
  const { toast } = useToast();
  const switches = useAssessmentSwitches();
  const [paper, retry] = useLoad(() => findPaper(paperId), `paper:${paperId}`);
  const p = dataOf(paper);
  // bd-fmf24g.31: the paper's own questions. Not needed for the actions, so a failed read never blocks them.
  const [content] = useLoad(() => portal.getAssessmentPaperView(paperId), `paperview:${paperId}`);
  const view = dataOf(content);
  const canSend = useShareAvailable('paper');

  const open = async (artifact: 'paper' | 'answer_key') => {
    const r: DownloadResult = await downloadArtifact(paperId, artifact);
    if (r === 'unavailable') toast({ title: artifact === 'answer_key' ? C.noKey : C.notAvailable });
    if (r === 'failed') toast({ title: C.couldNotOpen, variant: 'destructive' });
  };

  if (paper.status !== 'ok') {
    return (
      <TeacherPage crumb={C.title} title={C.myPapers} backTo={ASSESSMENT_V2_BASE}>
        <LoadState status={paper.status} onRetry={retry} />
      </TeacherPage>
    );
  }
  if (!p) {
    return (
      <TeacherPage crumb={C.title} title={C.notFoundTitle} backTo={ASSESSMENT_V2_BASE}>
        <LoadState status="ok" empty emptyLabel={C.notFoundTitle} onRetry={retry} />
      </TeacherPage>
    );
  }

  const day = pkDay(p.ready_at);
  // A board-pattern paper: its key is the marking scheme, and it is not edited in the app (FDE_EDITING, the
  // operator's cut A of 15 Oct: the editor would have to keep the board's shape).
  const fde = !!p.pattern;
  const chips = (
    <>
      {fde && <Chip tone="indigo">{C.fdeChip}</Chip>}
      {p.chapter_number != null && <Chip>{C.chapterShort(p.chapter_number)}</Chip>}
      {p.question_count != null && <Chip>{C.questionsCount(p.question_count)}</Chip>}
      {p.total_marks != null && <Chip>{C.marksCount(p.total_marks)}</Chip>}
      {p.version != null && <Chip tone="done">{C.versionLong(p.version)}</Chip>}
      {day && <Chip>{dayLabel(day, pkToday(), C.days)}</Chip>}
    </>
  );
  // bd-fmf24g.30 — the dock is the kit's ShareActions (Send on WhatsApp; Open in another app = the paper's PDF link).
  // Download moves into the list below, where Key already is.
  const dock = (
    <ShareActions
      available={canSend}
      onSend={() => shareToWhatsApp('paper', paperId)}
      open={{ fileUrl: async () => (await portal.getAssessmentDownload(paperId, 'paper'))?.url ?? null }}
    />
  );

  const rows: JSX.Element[] = [];
  rows.push(<ActionRow key="download" first onPress={() => open('paper')} icon={<Download className="h-5 w-5" aria-hidden="true" />} label={fde ? C.join(C.download, C.questionPaper) : C.download} />);
  if (p.has_answer_key) {
    rows.push(fde
      ? <ActionRow key="key" first={rows.length === 0} onPress={() => open('answer_key')} icon={<ClipboardCheck className="h-5 w-5" aria-hidden="true" />} label={C.markingScheme} />
      : <ActionRow key="key" first={rows.length === 0} onPress={() => open('answer_key')} icon={<KeyRound className="h-5 w-5" aria-hidden="true" />} label={C.answerKey} />);
  }
  if (switches?.editing) {
    if (!fde || FDE_EDITING) rows.push(<ActionRow key="edit" first={rows.length === 0} to={editPath(paperId)} icon={<Pencil className="h-5 w-5" aria-hidden="true" />} label={C.edit} />);
    rows.push(<ActionRow key="versions" first={rows.length === 0} to={versionsPath(paperId)} icon={<History className="h-5 w-5" aria-hidden="true" />} label={C.versions} />);
  }

  return (
    <TeacherPage crumb={C.title} title={C.gradeSubject(p.grade ?? '', p.subject)} backTo={ASSESSMENT_V2_BASE} chips={chips} dock={dock} testId="assessment-paper">
      {/* The paper itself (bd-fmf24g.31): its D6.5 heading, then its sections. The actions sit below it. */}
      <ListCard label={C.thePaper}>
        <HistoryRow
          grade={p.grade ?? undefined} subject={p.subject} title={p.subject}
          extra={C.join(p.chapter_number != null ? C.chapterShort(p.chapter_number) : null, p.total_marks != null ? C.marksCount(p.total_marks) : null)}
          action="none"
        />
      </ListCard>
      {content.status === 'loading' || content.status === 'idle'
        ? <SkeletonList rows={3} label={C.thePaper} className="py-2" />
        : view && view.sections.length > 0
          ? <PaperBody view={view} />
          : <p className="rounded-2xl border border-dashed border-[#c7cad6] bg-white p-5 text-center text-[16px] font-semibold text-[#4b5563]">{C.downloadToView}</p>}
      {rows.length > 0 && <ListCard label={C.myPapers}>{rows}</ListCard>}
      {fde && ['android-iab', 'ios-iab'].includes(browserEnv()) && (
        <p data-testid="fde-if-no-download" className="px-2 text-center text-[14px] text-[#4b5563]">{C.ifNoDownload}</p>
      )}
    </TeacherPage>
  );
}
