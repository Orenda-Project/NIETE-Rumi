import { useState } from 'react';
import { useCopy } from '../i18n';
import { BookOpen, FileText, GraduationCap, Play, PlayCircle } from 'lucide-react';
import { TRAINING, TRAINING_INNER } from './copy';
import { moduleExamState, useTrainingCourse } from '../../newui/training/TrainingCourse';
import { courseName, type ExamGate, type ReadingItem, type ReadingList } from '../../newui/training/trainingApi';
import { ListRow, StatusChip, Tray, type ChipData } from '../ui';
import { partRows } from './inner';
import { DockButton, V2Row } from './parts';
import { LoadState, TrainingPageV2 } from './TrainingFrame';

/**
 * bd-fmf24g.12 — a course (v28 canvas TrainingCourse): its parts as Part tiles (stacked "PART" over the
 * number), done with its length and best quick-check score, the next one marked Next, a locked one off; then
 * I-SAPS's module exam and Required reading; Continue opens the next part. Every read and rule is the new
 * UI's course page's (useTrainingCourse); only the look is v2.
 */
export function CoursePage() {
  const T = useCopy(TRAINING_INNER);
  const C = useCopy(TRAINING);
  const { vendorKey, levelId, courseId, paths, modules, attempts, course, provider, levelWord, list, next, doneCount } = useTrainingCourse();
  const rows = partRows(list, next, attempts);

  return (
    <TrainingPageV2
      crumb={T.crumb(provider, levelWord)}
      title={courseName(course?.title)}
      backTo={paths.level(vendorKey, levelId)}
      dock={next ? <DockButton icon={Play} to={paths.unit(next.id)} testId="training-course-continue">{T.continue}</DockButton> : undefined}
    >
      <LoadState loading={modules.loading && !modules.data} failed={!modules.loading && !!modules.error} onRetry={modules.reload} />

      {modules.data ? (
        <>
          <h2 className="mx-1 mt-1 flex items-center gap-2 text-[20px] font-light">
            {T.parts}
            <StatusChip text={T.of(doneCount, list.length)} tone="info" />
          </h2>
          <div className="flex flex-col gap-2.5" data-testid="training-parts">
            {rows.map((r) => {
              const sub = [r.seconds ? T.minutes(r.seconds) : null, r.best ? C.best(T.of(r.best.score, r.best.max)) : null].filter(Boolean).join(' · ');
              const chip: ChipData | null = r.state === 'done' ? { text: T.done, tone: 'done' } : r.state === 'next' ? { text: T.next, tone: 'info' } : null;
              return (
                <ListRow
                  key={r.id}
                  prefix={C.partPrefix}
                  number={r.n}
                  label={r.title}
                  subtitle={sub || undefined}
                  chip={chip}
                  state={r.state === 'locked' ? 'locked' : 'default'}
                  to={r.state === 'locked' ? undefined : paths.unit(r.id)}
                />
              );
            })}
          </div>

          {modules.data.exam || hasReadings(modules.data.readings) ? (
            <h2 className="mx-1 mt-2 text-[20px] font-light">{C.more}</h2>
          ) : null}
          {modules.data.exam ? <ModuleExamRowV2 exam={modules.data.exam} to={paths.exam(courseId)} /> : null}
          {hasReadings(modules.data.readings) ? <ReadingsV2 readings={modules.data.readings!} /> : null}
        </>
      ) : null}
    </TrainingPageV2>
  );
}

function ModuleExamRowV2({ exam, to }: { exam: ExamGate; to: string }) {
  const T = useCopy(TRAINING_INNER);
  const { state, word } = moduleExamState(exam);
  const chip: ChipData = state === 'ready' ? { text: T.ready, tone: 'done' }
    : state === 'passed' ? { text: word || T.passed, tone: 'done' }
      : state === 'grading' ? { text: word || T.beingGraded, tone: 'waiting' }
        : { text: word || T.locked, tone: 'info' };
  return <V2Row icon={GraduationCap} title={T.moduleExam} chip={chip} to={state === 'locked' ? undefined : to} off={state === 'locked'} testId="module-exam-row" />;
}

const hasReadings = (r: ReadingList | null | undefined) => Boolean(r && ((r.available || []).length || (r.unavailable || []).length));
const readingIcon = (r: ReadingItem) => (/video|ted|talk|lecture/i.test(r.type) ? PlayCircle : /book|novel|textbook/i.test(r.type) ? BookOpen : FileText);

/** I-SAPS required reading: a row, and the list in a tray (the new UI's ReadingsRow, restyled). Gates nothing. */
function ReadingsV2({ readings }: { readings: ReadingList }) {
  const T = useCopy(TRAINING_INNER);
  const [open, setOpen] = useState(false);
  const on = readings.available || [];
  const off = readings.unavailable || [];
  return (
    <>
      <V2Row
        icon={BookOpen}
        title={T.reading}
        chip={{ text: on.length ? T.readings(on.length) : T.comingSoon, tone: 'info' }}
        onPress={() => setOpen(true)}
        testId="readings-row"
      />
      <Tray open={open} title={T.reading} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-2.5">
          {on.map((r, i) => (
            <V2Row
              key={`on-${i}`}
              icon={readingIcon(r)}
              title={r.title}
              sub={[r.section, r.author].filter(Boolean).join(' · ') || undefined}
              end="external"
              onPress={() => { if (r.url) window.open(r.url, '_blank', 'noopener,noreferrer'); }}
            />
          ))}
          {off.map((r, i) => (
            <V2Row key={`off-${i}`} icon={readingIcon(r)} title={r.title} sub={r.author || undefined} chip={{ text: T.comingSoon, tone: 'waiting' }} end="none" />
          ))}
        </div>
      </Tray>
    </>
  );
}

