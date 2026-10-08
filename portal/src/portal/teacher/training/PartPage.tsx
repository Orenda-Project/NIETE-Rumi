import DOMPurify from 'dompurify';
import { useCopy } from '../i18n';
import { Check, ClipboardCheck, FileText, Lock, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AudioPlayer } from '../../newui/AudioPlayer';
import { TRAINING, TRAINING_INNER } from './copy';
import { openInNewTab } from '../../newui/training/certificateFile';
import { useTrainingPart } from '../../newui/training/TrainingPart';
import { ListRow, StatusChip } from '../ui';
import { CARD } from '../ui/styles';
import { DockButton, HeroCard, V2Row } from './parts';
import { LoadState, TrainingPageV2 } from './TrainingFrame';

/**
 * bd-fmf24g.12 — a part (v28 canvas TrainingPart): its place, length and Done as chips under the title; the
 * video and the audio; Handout and Quick check rows; the part's text; Up next once done. The button is the new
 * UI's: Start quick check, or Mark done with no quiz, then Continue. Every read and rule (Mark done included)
 * is useTrainingPart's; only the look is v2.
 */
export function PartPage() {
  const T = useCopy(TRAINING_INNER);
  const C = useCopy(TRAINING);
  const { moduleId, paths, detail, d, done, at, sorted, notSaved, best, after, courseUrl, markDone, saving, locked } = useTrainingPart();

  const chips = d ? (
    <>
      {at >= 0 ? <StatusChip text={T.part(at + 1, sorted.length)} tone="info" /> : null}
      {d.duration_seconds > 0 ? <StatusChip text={T.minutes(d.duration_seconds)} tone="info" /> : null}
      {done ? <StatusChip text={T.done} tone="done" tick /> : null}
      {notSaved ? <StatusChip text={T.notSaved} tone="error" /> : null}
    </>
  ) : undefined;

  const dock = d ? (
    d.has_questions ? <DockButton icon={ClipboardCheck} to={paths.quiz(moduleId)} testId="training-start-quiz">{T.startQuickCheck}</DockButton>
      : !done ? <DockButton icon={Check} onClick={markDone} disabled={saving} testId="training-mark-done">{T.markDone}</DockButton>
        : after || courseUrl ? <DockButton icon={Play} to={after ? paths.unit(after.id) : courseUrl!} testId="training-part-continue">{T.continue}</DockButton>
          : undefined
  ) : undefined;

  return (
    <TrainingPageV2 crumb={T.crumb(d?.course?.title)} title={d?.title ?? ''} backTo={courseUrl ?? paths.home} context={chips} dock={dock}>
      <LoadState loading={detail.loading} failed={!detail.loading && !!detail.error && !locked} onRetry={detail.reload} />
      {locked ? <HeroCard icon={Lock} tone="quiet" title={T.locked} /> : null}

      {d ? (
        <>
          {d.video_url ? (
            <video controls preload="metadata" src={d.video_url} aria-label={C.video} className="aspect-video w-full rounded-2xl bg-[#1d2025]" data-testid="training-video" />
          ) : null}
          {d.audio_url ? <AudioPlayer src={d.audio_url} label={C.audio} testId="training-audio" /> : null}

          {d.pdf_url ? (
            <V2Row icon={FileText} title={T.handout} chip={{ text: T.pdf, tone: 'info' }} end="external" onPress={() => openInNewTab(d.pdf_url!)} testId="training-handout" />
          ) : null}
          {d.has_questions ? (
            <V2Row
              icon={ClipboardCheck}
              title={T.quickCheck}
              chip={best ? { text: C.best(T.of(best.score, best.max_score)), tone: 'info' } : null}
              to={paths.quiz(moduleId)}
              testId="training-quick-check"
            />
          ) : null}

          {d.content_html && d.content_html.trim() ? (
            <div
              dir="auto"
              className={cn(CARD, 'prose prose-sm max-w-none p-4 text-[#374151]')}
              // DOMPurify sanitises before render, as the new UI's part page does.
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(d.content_html) }}
            />
          ) : null}

          {after ? (
            <>
              <h2 className="mx-1 mt-2 text-[20px] font-light">{C.upNext}</h2>
              <ListRow
                prefix={C.partPrefix}
                number={(sorted.findIndex((m) => m.id === after.id) + 1) || ''}
                label={after.title}
                subtitle={after.duration_seconds > 0 ? T.minutes(after.duration_seconds) : undefined}
                to={paths.unit(after.id)}
              />
            </>
          ) : null}
        </>
      ) : null}
    </TrainingPageV2>
  );
}
