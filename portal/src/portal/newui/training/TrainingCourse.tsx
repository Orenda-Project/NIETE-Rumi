import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { BookOpen, Check, Clock, ExternalLink, FileText, GraduationCap, Lock, Play, PlayCircle, Star, Timer } from 'lucide-react';
import { List, Row, SectionLabel } from '../List';
import { Chip } from '../Chip';
import { BottomButton } from '../BottomButton';
import { Hero } from '../Hero';
import { Sheet } from '../Sheet';
import { TRAINING_COPY } from '../copy';
import { Loading, NotLoaded, TrainingActions, TrainingInner } from './frame';
import {
  bestAttempt, isLadder, nextPart, providerLabel, trainingBase, trainingPaths, useAttempts, useGet,
  type Course, type ExamGate, type Level, type ModuleSummary, type ReadingItem, type ReadingList, type Vendor,
} from './trainingApi';

/**
 * bd-5rz1v.25 — /portal/training/provider/:vendorKey/level/:levelId/course/:browseCourseId
 * (deep-screens.html, Training 4). A course's parts — teachers see "Part"; the code says
 * "module" — under the light bar (crumb "Training · NIETE · Level 2", title the course).
 *
 *   done    a green check tile; its duration and best quick-check score ("9/10", neutral)
 *   next    the first part not done and not locked: a play icon and "Next"
 *   locked  off and not tappable (the bot's unit lock, bd-vej4h; the server refuses it anyway)
 *   other   open parts in any order show their number
 * Then the I-SAPS module exam as a row (the gate's own word as a chip, bd-60166) and Recommended
 * reading as a row that opens a sheet (I-SAPS, optional, gates nothing). Continue at the bottom
 * opens the next part.
 */
export default function TrainingCourse() {
  const { vendorKey = '', levelId = '', browseCourseId: courseId = '' } = useParams();
  const { pathname } = useLocation();
  const paths = trainingPaths(trainingBase(pathname));

  const vendors = useGet<Vendor[]>('/training/vendors', undefined, (d) => (d as { vendors?: Vendor[] })?.vendors || []);
  const levels = useGet<Level[]>('/training/levels', undefined, (d) => (d as { levels?: Level[] })?.levels || []);
  const courses = useGet<Course[]>('/training/courses', { level_id: levelId }, (d) => (d as { courses?: Course[] })?.courses || []);
  const modules = useGet<{ modules: ModuleSummary[]; exam: ExamGate | null; readings: ReadingList | null }>(
    '/training/modules',
    { course_id: courseId },
    (d) => {
      const x = d as { modules?: ModuleSummary[]; exam?: ExamGate | null; readings?: ReadingList | null };
      return { modules: [...(x?.modules || [])].sort((a, b) => a.order_index - b.order_index), exam: x?.exam ?? null, readings: x?.readings ?? null };
    },
  );
  const attempts = useAttempts(modules.data?.modules ?? null);

  const level = levels.data?.find((l) => String(l.id) === String(levelId)) ?? null;
  const course = courses.data?.find((c) => String(c.id) === String(courseId)) ?? null;
  const provider = providerLabel(vendorKey, vendors.data);
  const levelWord = level ? (isLadder(level) ? TRAINING_COPY.levelN(level.order_index + 1) : level.name) : null;
  const list = modules.data?.modules ?? [];
  const next = nextPart(list);
  const doneCount = list.filter((m) => m.completed_at).length;

  return (
    <TrainingInner crumb={TRAINING_COPY.crumb(provider, levelWord)} title={course?.title ?? ''} backTo={paths.level(vendorKey, levelId)}>
      {modules.loading && !modules.data ? <Loading /> : null}
      {!modules.loading && modules.error ? <NotLoaded onRetry={modules.reload} /> : null}

      {modules.data ? (
        <>
          <SectionLabel aside={TRAINING_COPY.of(doneCount, list.length)}>{TRAINING_COPY.parts}</SectionLabel>
          {list.length === 0 ? <Hero title={TRAINING_COPY.empty} icon={BookOpen} tone="neutral" /> : (
            <List label={TRAINING_COPY.parts}>
              {list.map((m, i) => (
                <PartRow key={m.id} part={m} n={i + 1} isNext={next?.id === m.id} attempts={attempts[m.id]} to={paths.unit(m.id)} />
              ))}
            </List>
          )}
          {modules.data.exam || hasReadings(modules.data.readings) ? (
            <List>
              {modules.data.exam ? <ModuleExamRow exam={modules.data.exam} to={paths.exam(courseId)} /> : null}
              {hasReadings(modules.data.readings) ? <ReadingsRow readings={modules.data.readings!} /> : null}
            </List>
          ) : null}
        </>
      ) : null}

      {next ? (
        <TrainingActions>
          <BottomButton icon={Play} to={paths.unit(next.id)} testId="training-course-continue">{TRAINING_COPY.continue}</BottomButton>
        </TrainingActions>
      ) : null}
    </TrainingInner>
  );
}

function PartRow({ part: m, n, isNext, attempts, to }: {
  part: ModuleSummary; n: number; isNext: boolean; attempts: ReturnType<typeof useAttempts>[string] | undefined; to: string;
}) {
  const best = bestAttempt(attempts ?? null);
  const duration = m.duration_seconds > 0 ? <Chip icon={Clock}>{TRAINING_COPY.minutes(m.duration_seconds)}</Chip> : null;
  const score = best ? <Chip icon={Star}>{TRAINING_COPY.of(best.score, best.max_score)}</Chip> : null;

  if (m.completed_at) {
    return <Row tile="done" title={m.title} chips={<>{duration}{score}</>} to={to} testId={`training-part-${m.id}`} />;
  }
  if (m.lock === 'locked') {
    return <Row icon={Lock} tile="quiet" title={m.title} state="off" onClick={() => {}} chips={duration} testId={`training-part-${m.id}`} />;
  }
  if (isNext) {
    return <Row icon={Play} title={m.title} chips={<>{duration}<Chip>{TRAINING_COPY.next}</Chip></>} to={to} testId={`training-part-${m.id}`} />;
  }
  return <Row lead={String(n)} title={m.title} chips={<>{duration}{score}</>} to={to} testId={`training-part-${m.id}`} />;
}

/**
 * The I-SAPS module exam (ModuleExamPanel's list row). Open → Ready, to the exam page. Closed →
 * the gate's own short label as a chip, emoji stripped (bd-60166: the row must say what the gate
 * says); a sat exam (passed, being graded) still opens its page, where she can read it back.
 */
function ModuleExamRow({ exam, to }: { exam: ExamGate; to: string }) {
  const word = (exam.cta || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  if (exam.available) {
    return <Row icon={GraduationCap} title={TRAINING_COPY.moduleExam} chips={<Chip tone="done">{TRAINING_COPY.ready}</Chip>} to={to} testId="module-exam-row" />;
  }
  const passed = /passed/i.test(exam.cta || '') || /passed/i.test(exam.body || '');
  const grading = /being graded/i.test(exam.cta || '') || /being graded/i.test(exam.body || '');
  if (passed) {
    return <Row icon={GraduationCap} tile="done" title={TRAINING_COPY.moduleExam} chips={<Chip tone="done" icon={Check}>{word || TRAINING_COPY.passed}</Chip>} to={to} testId="module-exam-row" />;
  }
  if (grading) {
    return <Row icon={GraduationCap} title={TRAINING_COPY.moduleExam} chips={<Chip tone="waiting" icon={Timer}>{word || TRAINING_COPY.beingGraded}</Chip>} to={to} testId="module-exam-row" />;
  }
  return <Row icon={Lock} tile="quiet" title={TRAINING_COPY.moduleExam} state="off" onClick={() => {}} chips={<Chip icon={Lock}>{word || TRAINING_COPY.locked}</Chip>} testId="module-exam-row" />;
}

const hasReadings = (r: ReadingList | null | undefined) => Boolean(r && ((r.available || []).length || (r.unavailable || []).length));

const readingIcon = (r: ReadingItem) => (/video|ted|talk|lecture/i.test(r.type) ? PlayCircle : /book|novel|textbook/i.test(r.type) ? BookOpen : FileText);

/** I-SAPS recommended reading (ModuleReadings): a row, and the list in a sheet. Optional. */
function ReadingsRow({ readings }: { readings: ReadingList }) {
  const [open, setOpen] = useState(false);
  const on = readings.available || [];
  const off = readings.unavailable || [];
  return (
    <>
      <Row
        icon={BookOpen}
        title={TRAINING_COPY.reading}
        chips={on.length ? <Chip>{TRAINING_COPY.available(on.length)}</Chip> : <Chip>{TRAINING_COPY.comingSoon}</Chip>}
        onClick={() => setOpen(true)}
        testId="readings-row"
      />
      <Sheet open={open} title={TRAINING_COPY.reading} onClose={() => setOpen(false)}>
        <List>
          {on.map((r, i) => (
            <Row
              key={`on-${i}`}
              icon={readingIcon(r)}
              title={r.title}
              chips={[r.author, r.type].filter(Boolean).map((t) => <Chip key={t}>{t}</Chip>)}
              end={ExternalLink}
              onClick={() => { if (r.url) window.open(r.url, '_blank', 'noopener,noreferrer'); }}
            />
          ))}
          {off.map((r, i) => (
            <Row
              key={`off-${i}`}
              icon={readingIcon(r)}
              tile="quiet"
              title={r.title}
              chips={<><Chip tone="waiting">{TRAINING_COPY.comingSoon}</Chip>{r.author ? <Chip>{r.author}</Chip> : null}</>}
            />
          ))}
        </List>
      </Sheet>
    </>
  );
}
