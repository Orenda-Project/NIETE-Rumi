import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Award, BookOpen, Check, Download, ListChecks, Lock, PenLine, Timer, Trophy } from 'lucide-react';
import api from '../../services/api';
import { List, Row, SectionLabel } from '../List';
import { Chip } from '../Chip';
import { Hero } from '../Hero';
import { Sheet } from '../Sheet';
import { TRAINING_COPY, type TrainingWords } from '../copy';
import { Loading, NotLoaded, TrainingInner } from './frame';
import { certificateUrl, downloadCertificate } from './certificateFile';
import {
  courseName,
  courseDone, isExamless, isLadder, lockedBehind, percent, providerLabel, statusOf, trainingBase, trainingPaths, useGet,
  type Course, type GrandQuizGate, type Level, type Vendor,
} from './trainingApi';

/**
 * bd-5rz1v.25 — /portal/training/provider/:vendorKey/level/:levelId (deep-screens.html,
 * Training 3). Under the light bar (crumb "Training · NIETE", title "Level 2 · Emerging"):
 *
 *   the level exam   a row on top, from the gate (GET /training/level/:id/grand-quiz, the one
 *                    LevelExamCard reads): "3 more courses" with a lock (information only),
 *                    Ready, Wait 18h, Passed — the last three open the exam page. No row when the
 *                    level has no exam, nor for I-SAPS, which is assessed per module (bd-60152).
 *   the courses      "Courses 2/5", then a row each: its number (green when done), Done or "3/7",
 *                    a bar while part-way.
 *   I-SAPS           the level certificate as a row (LevelCertificateRow's states: the exams
 *                    passed and a bar; Receive once all are, which asks the server; then
 *                    Download), and My scores in a sheet.
 *   Beacon House     the written quiz's result as a row (CapstoneResultCard): score and Passed;
 *                    a tap shows her answers and the feedback.
 */
export default function TrainingLevel() {
  const { vendorKey = '', levelId = '' } = useParams();
  const { pathname } = useLocation();
  const paths = trainingPaths(trainingBase(pathname));

  const vendors = useGet<Vendor[]>('/training/vendors', undefined, (d) => (d as { vendors?: Vendor[] })?.vendors || []);
  const levels = useGet<Level[]>('/training/levels', undefined, (d) => (d as { levels?: Level[] })?.levels || []);
  const courses = useGet<Course[]>('/training/courses', { level_id: levelId }, (d) =>
    [...((d as { courses?: Course[] })?.courses || [])].sort((a, b) => a.order_index - b.order_index));

  const level = levels.data?.find((l) => String(l.id) === String(levelId)) ?? null;
  const siblings = (levels.data || []).filter((l) => l.vendor_key === vendorKey);
  const examless = isExamless(vendorKey);
  const ladder = level ? isLadder(level) : true;
  const open = level ? level.state !== 'locked' : false;

  const gate = useGet<GrandQuizGate | null>(
    level && open && !examless ? `/training/level/${levelId}/grand-quiz` : null,
    undefined,
    (d) => (d as { grand_quiz?: GrandQuizGate })?.grand_quiz ?? null,
  );

  const provider = providerLabel(vendorKey, vendors.data);
  const title = level ? (ladder ? TRAINING_COPY.levelTitle(level.order_index + 1, level.name) : level.name) : provider;
  // A one-level provider has no levels page to go back to: Back goes to Training.
  const backTo = siblings.length === 1 ? paths.home : paths.provider(vendorKey);

  const locked = statusOf(courses.error) === 403;
  const behind = lockedBehind(courses.error);
  const doneCount = (courses.data || []).filter(courseDone).length;

  return (
    <TrainingInner crumb={TRAINING_COPY.crumb(provider)} title={title} backTo={backTo}>
      {gate.data && level ? <ExamRow gate={gate.data} level={level} to={paths.levelExam(vendorKey, levelId)} /> : null}

      {courses.loading ? <Loading /> : null}
      {locked ? (
        <Hero
          title={TRAINING_COPY.locked}
          icon={Lock}
          tone="neutral"
          chips={behind != null ? <Chip icon={Lock}>{TRAINING_COPY.passLevel(behind + 1)}</Chip> : undefined}
        />
      ) : null}
      {!courses.loading && courses.error && !locked ? <NotLoaded onRetry={courses.reload} /> : null}

      {courses.data ? (
        <>
          <SectionLabel aside={TRAINING_COPY.of(doneCount, courses.data.length)}>{TRAINING_COPY.courses}</SectionLabel>
          {courses.data.length === 0 ? <Hero title={TRAINING_COPY.empty} icon={BookOpen} tone="neutral" /> : (
            <List label={TRAINING_COPY.courses}>
              {courses.data.map((c, i) => {
                const done = courseDone(c);
                const part = c.completed_count > 0 && !done;
                return (
                  <Row
                    key={c.id}
                    lead={String(i + 1)}
                    tile={done ? 'done' : 'neutral'}
                    title={courseName(c.title)}
                    chips={done
                      ? <Chip tone="done" icon={Check}>{TRAINING_COPY.done}</Chip>
                      : <Chip>{TRAINING_COPY.of(c.completed_count, c.module_count)}</Chip>}
                    progress={part ? percent(c.completed_count, c.module_count) : undefined}
                    to={paths.course(vendorKey, levelId, c.id)}
                    testId={`training-course-${c.id}`}
                  />
                );
              })}
            </List>
          )}
        </>
      ) : null}

      {level && !ladder ? <CapstoneRow levelId={level.id} /> : null}
      {level && examless && open ? <LevelCertificate levelId={level.id} onIssued={levels.reload} /> : null}
    </TrainingInner>
  );
}

/* ── the level exam, as a row ─────────────────────────────────────────────── */

export function hoursLeft(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
}

function ExamRow({ gate, level, to }: { gate: GrandQuizGate; level: Level; to: string }) {
  if (gate.state === 'no_quiz') return null;
  const left = Math.max(1, (level.courses_total || 0) - (level.courses_completed || 0));
  const common = { icon: Trophy, title: TRAINING_COPY.levelExam };
  let row;
  if (gate.state === 'courses_incomplete') {
    row = <Row {...common} chips={<Chip icon={Lock}>{TRAINING_COPY.moreCourses(left)}</Chip>} />;
  } else if (gate.state === 'ready') {
    row = <Row {...common} chips={<Chip tone="done">{TRAINING_COPY.ready}</Chip>} to={to} />;
  } else if (gate.state === 'cooldown') {
    row = <Row {...common} chips={<Chip tone="waiting" icon={Timer}>{TRAINING_COPY.waitHours(hoursLeft(gate.cooldown_until))}</Chip>} to={to} />;
  } else {
    row = <Row {...common} chips={<Chip tone="done" icon={Award}>{TRAINING_COPY.passed}</Chip>} to={to} />;
  }
  return <div data-testid="level-exam-row"><List>{row}</List></div>;
}

/* ── Beacon House: the written quiz's result (CapstoneResultCard) ─────────── */

type CapstoneRecord = {
  attempt: { id: string; status: string; is_passed: boolean; score: number; total_score: number; completed_at: string | null } | null;
  answers?: Array<{ question_index: number; question_text: string; answer_text: string; answer_score: number | null; feedback_text: string }>;
};

/** bd-fmf24g.13 — `words`: the teacher v2's translation of TRAINING_COPY (English when left out). */
export function CapstoneRow({ levelId, words }: { levelId: number; words?: TrainingWords }) {
  const T = words ?? (TRAINING_COPY as TrainingWords);
  const record = useGet<CapstoneRecord>(`/training/level/${levelId}/capstone`);
  const [open, setOpen] = useState(false);
  const a = record.data?.attempt;
  if (!a) return null;
  const answers = record.data?.answers || [];
  const status = a.is_passed
    ? <Chip tone="done" icon={Check}>{T.passed}</Chip>
    : a.status === 'in_progress'
      ? <Chip tone="waiting">{T.onWhatsApp}</Chip>
      : <Chip>{T.notPassed}</Chip>;
  return (
    <div data-testid="capstone-row">
      <List>
        <Row
          icon={PenLine}
          title={T.writtenQuiz}
          chips={<><Chip>{T.of(a.score, a.total_score)}</Chip>{status}</>}
          onClick={answers.length ? () => setOpen(true) : undefined}
        />
      </List>
      <Sheet open={open} title={T.writtenQuiz} onClose={() => setOpen(false)}>
        <ol className="flex flex-col gap-2.5">
          {answers.map((ans) => (
            <li key={ans.question_index} className="flex flex-col gap-1.5 rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card p-3">
              <p className="text-[15px] font-bold text-nu-surface-text">{ans.question_text}</p>
              <p className="whitespace-pre-wrap text-[15px] text-nu-surface-text">{ans.answer_text}</p>
              <span className="flex flex-wrap gap-[5px]"><Chip>{T.outOfFive(ans.answer_score)}</Chip></span>
              {ans.feedback_text ? <p className="text-sm text-nu-surface-muted">{ans.feedback_text}</p> : null}
            </li>
          ))}
        </ol>
      </Sheet>
    </div>
  );
}

/* ── I-SAPS: the level certificate (LevelCertificateRow) ──────────────────── */

type ExamMarks = { passed: boolean; pending?: boolean; mcq_earned: number; mcq_possible: number; crq_earned: number | null; crq_max: number };
type CertState = {
  state: 'issued' | 'locked';
  certificate: { certificate_code: string; issued_at?: string } | null;
  units_total: number;
  units_done: number;
  exams_total?: number;
  exams_done?: number;
  scores?: { modules: Array<{ course_id: number; title: string; units: Array<{ id: number; title: string; best_pct: number | null }>; exam: ExamMarks | null }> } | null;
};

/** bd-fmf24g.13 — `words`: the teacher v2's translation of TRAINING_COPY (English when left out). */
export function LevelCertificate({ levelId, onIssued, words }: { levelId: number; onIssued: () => void; words?: TrainingWords }) {
  const T = words ?? (TRAINING_COPY as TrainingWords);
  const info = useGet<CertState>(`/training/level/${levelId}/certificate`);
  const [claiming, setClaiming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scoresOpen, setScoresOpen] = useState(false);
  const d = info.data;
  if (!d) return null;

  // The SERVER decides (bd-60145): Receive always asks it. The counts only say when to offer it.
  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    setFailed(false);
    try {
      const { data } = await api.post(`/training/level/${levelId}/certificate`);
      info.reload();
      if (data?.issued) onIssued();
    } catch {
      setFailed(true);
    } finally {
      setClaiming(false);
    }
  };

  const scores = d.scores && Array.isArray(d.scores.modules) && d.scores.modules.length ? d.scores : null;
  const examsTotal = d.exams_total || 0;
  const done = examsTotal > 0 ? Math.min(examsTotal, d.exams_done || 0) : Math.min(d.units_total || 0, d.units_done || 0);
  const total = examsTotal > 0 ? examsTotal : d.units_total || 0;
  const ready = total > 0 && done >= total;
  const failChip = failed ? <Chip tone="error">{T.notLoaded}</Chip> : null;

  let row;
  if (d.state === 'issued' && d.certificate) {
    const url = certificateUrl(d.certificate.certificate_code);
    row = (
      <Row
        icon={Award}
        tile="done"
        title={T.levelCertificate}
        chips={<Chip tone="done">{T.ready}</Chip>}
        value={T.download}
        end={Download}
        onClick={() => downloadCertificate(url)}
        testId="level-certificate-download"
      />
    );
  } else {
    row = (
      <Row
        icon={ready ? Award : Lock}
        title={T.levelCertificate}
        chips={<><Chip>{examsTotal > 0 ? T.exams(done, total) : T.of(done, total)}</Chip>{failChip}</>}
        progress={percent(done, total)}
        value={ready ? T.receive : undefined}
        onClick={ready && !claiming ? claim : undefined}
        testId="level-certificate-claim"
      />
    );
  }

  return (
    <div data-testid="level-certificate-row">
      <List>
        {row}
        {scores ? <Row icon={ListChecks} title={T.myScores} onClick={() => setScoresOpen(true)} testId="level-scores" /> : null}
      </List>
      {scores ? (
        <Sheet open={scoresOpen} title={T.myScores} onClose={() => setScoresOpen(false)}>
          <div className="flex flex-col gap-2.5">
            {scores.modules.map((m) => (
              <section key={m.course_id} className="flex flex-col gap-1.5">
                <h3 className="px-1 text-[15px] font-bold text-nu-surface-text">{courseName(m.title)}</h3>
                <span className="flex flex-wrap gap-[5px] px-1">
                  {m.exam ? (
                    <>
                      {m.exam.pending
                        ? <Chip tone="waiting">{T.beingGraded}</Chip>
                        : m.exam.passed ? <Chip tone="done">{T.passed}</Chip> : <Chip>{T.notPassed}</Chip>}
                      <Chip>{T.choice(m.exam.mcq_earned, m.exam.mcq_possible)}</Chip>
                      <Chip>{T.written(m.exam.crq_earned, m.exam.crq_max)}</Chip>
                    </>
                  ) : <Chip>{T.notTaken}</Chip>}
                </span>
                <List>
                  {m.units.map((u) => (
                    <Row key={u.id} title={u.title} tile="quiet" icon={BookOpen} value={u.best_pct === null ? T.notTaken : T.pct(u.best_pct)} valueMuted={u.best_pct === null} />
                  ))}
                </List>
              </section>
            ))}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
