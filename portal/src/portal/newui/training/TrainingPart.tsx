import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { Check, CircleAlert, ClipboardCheck, Clock, ExternalLink, FileText, Lock, Play, Star } from 'lucide-react';
import api from '../../services/api';
import { List, Row } from '../List';
import { Chip } from '../Chip';
import { BottomButton } from '../BottomButton';
import { Hero } from '../Hero';
import { TRAINING_COPY } from '../copy';
import { Loading, NotLoaded, TrainingActions, TrainingInner } from './frame';
import { openInNewTab } from './certificateFile';
import {
  courseName,
  bestAttempt, partAfter, statusOf, trainingBase, trainingPaths, useGet,
  type Level, type ModuleSummary, type QuizAttempt,
} from './trainingApi';

/**
 * bd-5rz1v.25 — /portal/training/unit/:moduleId, a part (deep-screens.html, Training 5). Under the
 * light bar (crumb "Training · <course>", the part's title):
 *
 *   chips    "Part 4/7" (its place in the course), its length, and Done once done
 *   media    the video and the audio players; the part's own text (sanitised, as before)
 *   rows     Handout (PDF, opens in a new tab as the old link did); Quick check ("5 Q", her
 *            best score) to the quiz; Up next once the part is done. No "Practice" chip
 *            (deep-screens.html has one): since bd-2450 only a PASS completes the part and
 *            opens the next, so the quick check is not practice.
 *   button   Start quick check; with no quiz, Mark done (POST /training/module/:id/complete, the
 *            old page's call), then Continue to the next part
 *
 * Everything is the old unit page's data (GET /training/module/:id, the course's /modules for its
 * place and the next part, /attempts for the best score). A part the server refuses (403, a
 * locked unit) says Locked.
 */
type Detail = {
  id: string;
  title: string;
  content_html: string;
  video_url: string | null;
  audio_url: string | null;
  pdf_url: string | null;
  has_questions: boolean;
  duration_seconds: number;
  order_index: number;
  completed_at: string | null;
  course: { id: string; title: string } | null;
  level: { id: number; name: string } | null;
};

export function useTrainingPart() {
  const { moduleId = '' } = useParams();
  const { pathname } = useLocation();
  const paths = trainingPaths(trainingBase(pathname));

  const detail = useGet<Detail>(`/training/module/${encodeURIComponent(moduleId)}`, undefined, (d) => (d as { module: Detail }).module);
  const d = detail.data;
  const courseId = d?.course?.id ?? null;
  const modules = useGet<ModuleSummary[]>(courseId ? '/training/modules' : null, courseId ? { course_id: courseId } : undefined,
    (x) => (x as { modules?: ModuleSummary[] })?.modules || []);
  const levels = useGet<Level[]>('/training/levels', undefined, (x) => (x as { levels?: Level[] })?.levels || []);
  const attempts = useGet<QuizAttempt[]>(`/training/module/${encodeURIComponent(moduleId)}/attempts`, undefined,
    (x) => (x as { attempts?: QuizAttempt[] })?.attempts || []);

  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notSaved, setNotSaved] = useState(false);

  const done = Boolean(completedAt || d?.completed_at);
  const list = (modules.data || []).map((m) => (m.id === moduleId && done && !m.completed_at ? { ...m, completed_at: completedAt || d?.completed_at || 'done' } : m));
  const sorted = [...list].sort((a, b) => a.order_index - b.order_index);
  const at = sorted.findIndex((m) => m.id === moduleId);
  const after = done ? partAfter(list, moduleId) : null;

  const levelId = d?.level?.id;
  const vendorKey = levels.data?.find((l) => l.id === levelId)?.vendor_key ?? null;
  const courseUrl = vendorKey && levelId != null && courseId ? paths.course(vendorKey, levelId, courseId) : null;
  const best = bestAttempt(attempts.data);

  const markDone = async () => {
    if (saving) return;
    setSaving(true);
    setNotSaved(false);
    try {
      const { data } = await api.post(`/training/module/${encodeURIComponent(moduleId)}/complete`);
      setCompletedAt(data?.completed_at || new Date().toISOString());
    } catch {
      setNotSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const locked = statusOf(detail.error) === 403;

  return { moduleId, pathname, paths, detail, d, courseId, modules, levels, attempts, completedAt, setCompletedAt, saving, setSaving, notSaved, setNotSaved, done, list, sorted, at, after, levelId, vendorKey, courseUrl, best, markDone, locked };
}

/** The view; every rule and read is useTrainingPart's, shared with the teacher app v2 (bd-fmf24g.12). */
export default function TrainingPart() {
  const { moduleId, paths, detail, d, saving, notSaved, done, sorted, at, after, courseUrl, best, markDone, locked } = useTrainingPart();
  return (
    <TrainingInner crumb={TRAINING_COPY.crumb(d?.course ? courseName(d.course.title) : null)} title={d?.title ?? ''} backTo={courseUrl ?? paths.home}>
      {detail.loading ? <Loading /> : null}
      {locked ? <Hero title={TRAINING_COPY.locked} icon={Lock} tone="neutral" /> : null}
      {!detail.loading && detail.error && !locked ? <NotLoaded onRetry={detail.reload} /> : null}

      {d ? (
        <div className="flex flex-col gap-3 md:max-w-[760px]">
          <div className="flex flex-wrap gap-1.5">
            {at >= 0 ? <Chip>{TRAINING_COPY.part(at + 1, sorted.length)}</Chip> : null}
            {d.duration_seconds > 0 ? <Chip icon={Clock}>{TRAINING_COPY.minutes(d.duration_seconds)}</Chip> : null}
            {done ? <Chip tone="done" icon={Check}>{TRAINING_COPY.done}</Chip> : null}
            {notSaved ? <Chip tone="error" icon={CircleAlert}>{TRAINING_COPY.notSaved}</Chip> : null}
          </div>

          {d.video_url ? (
            <video controls preload="metadata" src={d.video_url} className="aspect-video w-full rounded-2xl bg-nu-ink" data-testid="training-video" />
          ) : null}
          {d.audio_url ? <audio controls preload="metadata" src={d.audio_url} className="w-full" data-testid="training-audio" /> : null}

          {d.pdf_url || d.has_questions ? (
            <List>
              {d.pdf_url ? (
                <Row
                  icon={FileText}
                  title={TRAINING_COPY.handout}
                  chips={<Chip>{TRAINING_COPY.pdf}</Chip>}
                  end={ExternalLink}
                  onClick={() => openInNewTab(d.pdf_url!)}
                  testId="training-handout"
                />
              ) : null}
              {d.has_questions ? (
                <Row
                  icon={ClipboardCheck}
                  title={TRAINING_COPY.quickCheck}
                  chips={(
                    <>
                      {/* No count (bd-klecr.6): the bank is not the paper an attempt serves. */}
                      {best ? <Chip icon={Star}>{TRAINING_COPY.of(best.score, best.max_score)}</Chip> : null}
                    </>
                  )}
                  to={paths.quiz(moduleId)}
                  testId="training-quick-check"
                />
              ) : null}
            </List>
          ) : null}

          {d.content_html && d.content_html.trim() ? (
            <div
              dir="auto"
              className="prose prose-sm max-w-none rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card p-4 text-nu-surface-text"
              // DOMPurify sanitises before render, as the old unit page did.
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(d.content_html) }}
            />
          ) : null}

          {after ? (
            <List>
              <Row
                icon={Play}
                title={after.title}
                chips={(
                  <>
                    <Chip>{TRAINING_COPY.upNext}</Chip>
                    {after.duration_seconds > 0 ? <Chip icon={Clock}>{TRAINING_COPY.minutes(after.duration_seconds)}</Chip> : null}
                  </>
                )}
                to={paths.unit(after.id)}
                testId="training-up-next"
              />
            </List>
          ) : null}
        </div>
      ) : null}

      {d ? (
        <TrainingActions>
          {d.has_questions ? (
            <BottomButton icon={ClipboardCheck} to={paths.quiz(moduleId)} testId="training-start-quiz">{TRAINING_COPY.startQuickCheck}</BottomButton>
          ) : !done ? (
            <BottomButton icon={Check} onClick={markDone} disabled={saving} testId="training-mark-done">{TRAINING_COPY.markDone}</BottomButton>
          ) : after || courseUrl ? (
            <BottomButton icon={Play} to={after ? paths.unit(after.id) : courseUrl!} testId="training-part-continue">{TRAINING_COPY.continue}</BottomButton>
          ) : null}
        </TrainingActions>
      ) : null}
    </TrainingInner>
  );
}
