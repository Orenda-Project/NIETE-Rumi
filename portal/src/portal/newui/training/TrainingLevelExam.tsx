import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronRight, CircleAlert, Lock, PenLine, Play, Timer, Trophy, XCircle } from 'lucide-react';
import api from '../../services/api';
import { Chip } from '../Chip';
import { BottomButton } from '../BottomButton';
import { Hero } from '../Hero';
import { List, Row } from '../List';
import { Sheet } from '../Sheet';
import { AnswerChoices, QuestionDots } from '../Answers';
import { TRAINING_COPY } from '../copy';
import { Loading, NotLoaded, TrainingActions, TrainingInner } from './frame';
import { CertificateCard, WrittenAnswer, WrittenField } from './examParts';
import {
  isLadder, percent, providerLabel, statusOf, trainingBase, trainingPaths, useGet,
  type GrandQuizGate, type Level, type Vendor,
} from './trainingApi';

/**
 * bd-5rz1v.25 — /portal/training/provider/:vendorKey/level/:levelId/exam, the level exam
 * (deep-screens.html, Training 8). LevelExamCard and CapstoneExamForm on their own page, with
 * the same endpoints and the same answers:
 *
 *   gate      GET /training/level/:id/grand-quiz. Ready: a Hero (trophy, neutral) with the rules
 *             as chips — "20 Q", "80% to pass", amber "24h wait if failed" — and Start exam. Every
 *             number is the gate's; none sent, no chip (bd-2489, bd-2475). Courses left: Locked
 *             with "3 more courses". Cooldown: an amber Wait. Passed: the certificate card.
 *   exam      one question per screen (QuestionDots, AnswerChoices), Back to the previous
 *             question, Submit on the last: POST /grand-quiz/attempts, chosen_option 1-based.
 *   capstone  a written exam (Beacon House) the same way: one answer per screen with the server's
 *             character floor as a chip; POST /capstone/attempts.
 *   result    Passed (green) with the score and the new certificate's card, or Not passed with
 *             the wait as an amber chip. Leaving mid-exam discards the answers, as before.
 */
type ExamOption = string | { key?: string; text?: string; urdu?: string };
type GQuestion = { id: number; question_text: string; question_urdu: string | null; options: ExamOption[]; order_index: number };
type CQuestion = { id: number; question_text: string; order_index: number };
type Paper =
  | { kind: 'grand_quiz'; questions: GQuestion[] }
  | { kind: 'capstone'; questions: CQuestion[]; floor: number };
type Cert = { certificate_code: string; level_name: string; issued_at?: string } | null;
type Result = { score: number; max: number; passed: boolean; cooldownUntil: string | null; certificate: Cert; answers?: CapAnswer[] };
type CapAnswer = { question_index: number; question_text: string; answer_text: string; answer_score: number | null; feedback_text: string };

const optionText = (o: ExamOption) => (typeof o === 'string' ? o : o?.text ?? o?.key ?? '');

function hoursLeft(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
}

export default function TrainingLevelExam() {
  const { vendorKey = '', levelId = '' } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const paths = trainingPaths(trainingBase(pathname));

  const vendors = useGet<Vendor[]>('/training/vendors', undefined, (d) => (d as { vendors?: Vendor[] })?.vendors || []);
  const levels = useGet<Level[]>('/training/levels', undefined, (d) => (d as { levels?: Level[] })?.levels || []);
  const gate = useGet<GrandQuizGate | null>(`/training/level/${encodeURIComponent(levelId)}/grand-quiz`, undefined,
    (d) => (d as { grand_quiz?: GrandQuizGate })?.grand_quiz ?? null);

  const level = levels.data?.find((l) => String(l.id) === String(levelId)) ?? null;
  const provider = providerLabel(vendorKey, vendors.data);
  const title = level ? (isLadder(level) ? TRAINING_COPY.levelExamTitle(level.order_index + 1) : TRAINING_COPY.examOf(level.name)) : TRAINING_COPY.levelExam;
  const levelUrl = paths.level(vendorKey, levelId);

  const [paper, setPaper] = useState<Paper | null>(null);
  const [opening, setOpening] = useState(false);
  const [index, setIndex] = useState(0);
  const [picks, setPicks] = useState<Record<number, number[]>>({});
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [answersOpen, setAnswersOpen] = useState(false);

  const g = gate.data;

  const start = async () => {
    if (!g || opening) return;
    setOpening(true);
    setProblem(null);
    try {
      if (g.exam_kind === 'capstone') {
        const { data } = await api.get(`/training/level/${encodeURIComponent(levelId)}/capstone/questions`);
        setPaper({ kind: 'capstone', questions: [...(data.questions || [])].sort((a: CQuestion, b: CQuestion) => a.order_index - b.order_index), floor: Number(data.min_answer_chars) || 0 });
      } else {
        const { data } = await api.get(`/training/level/${encodeURIComponent(levelId)}/grand-quiz/questions`);
        setPaper({ kind: 'grand_quiz', questions: [...(data.questions || [])].sort((a: GQuestion, b: GQuestion) => a.order_index - b.order_index) });
      }
      setIndex(0); setPicks({}); setTexts({});
    } catch {
      // Eligibility may have changed elsewhere (a cooldown started on WhatsApp): ask again.
      setProblem(TRAINING_COPY.notLoaded);
      gate.reload();
    } finally {
      setOpening(false);
    }
  };

  const qs = paper?.questions ?? [];
  const q = qs[Math.min(index, Math.max(0, qs.length - 1))];
  const answered = (id: number) => (paper?.kind === 'capstone'
    ? (texts[id] || '').trim().length >= paper.floor
    : (picks[id] || []).length > 0);
  const last = index >= qs.length - 1;

  const submit = async () => {
    if (!paper || sending || !qs.every((x) => answered(x.id))) return;
    setSending(true);
    setProblem(null);
    try {
      if (paper.kind === 'capstone') {
        const { data } = await api.post(`/training/level/${encodeURIComponent(levelId)}/capstone/attempts`, {
          answers: paper.questions.map((x) => ({ question_id: x.id, answer_text: texts[x.id] })),
        });
        const a = data.attempt;
        setResult({ score: a.score, max: a.total_score, passed: a.is_passed, cooldownUntil: null, certificate: data.certificate || null, answers: data.answers || [] });
      } else {
        const { data } = await api.post(`/training/level/${encodeURIComponent(levelId)}/grand-quiz/attempts`, {
          answers: paper.questions.map((x) => ({ question_id: x.id, chosen_option: (picks[x.id] || []).map((i) => i + 1).join(',') })),
        });
        const a = data.attempt;
        setResult({ score: a.score, max: a.max_score, passed: a.is_passed, cooldownUntil: a.cooldown_until ?? null, certificate: data.certificate || null });
      }
      setPaper(null);
    } catch {
      setProblem(TRAINING_COPY.notSent);
      gate.reload();
    } finally {
      setSending(false);
    }
  };

  const back = () => {
    if (paper && index > 0) { setIndex((i) => i - 1); return; }
    if (paper) { setPaper(null); return; }
    navigate(-1);
  };

  const problemChip = problem ? <Chip tone="error" icon={CircleAlert}>{problem}</Chip> : null;

  /* ── the result ───────────────────────────────────────────────────────── */
  if (result) {
    const pct = percent(result.score, result.max);
    const waitH = result.cooldownUntil ? hoursLeft(result.cooldownUntil) : 0;
    return (
      <TrainingInner crumb={TRAINING_COPY.crumb(provider)} title={title} backTo={levelUrl}>
        <Hero
          title={result.passed ? TRAINING_COPY.passed : TRAINING_COPY.notPassed}
          icon={result.passed ? Trophy : XCircle}
          tone={result.passed ? 'done' : 'neutral'}
          live
          chips={(
            <>
              <Chip tone={result.passed ? 'done' : 'info'}>{TRAINING_COPY.of(result.score, result.max)}</Chip>
              <Chip>{TRAINING_COPY.pct(pct)}</Chip>
              {!result.passed && waitH > 0 ? <Chip tone="waiting" icon={Timer}>{TRAINING_COPY.waitHours(waitH)}</Chip> : null}
            </>
          )}
        />
        {result.certificate ? <CertificateCard certificate={result.certificate} /> : null}
        {result.answers && result.answers.length ? (
          <>
            <List>
              <Row icon={PenLine} title={TRAINING_COPY.myAnswers} onClick={() => setAnswersOpen(true)} testId="training-exam-answers" />
            </List>
            <Sheet open={answersOpen} title={TRAINING_COPY.myAnswers} onClose={() => setAnswersOpen(false)}>
              <ol className="flex flex-col gap-2.5">
                {result.answers.map((a) => (
                  <WrittenAnswer key={a.question_index} question={a.question_text} answer={a.answer_text} score={TRAINING_COPY.outOfFive(a.answer_score)} feedback={a.feedback_text} />
                ))}
              </ol>
            </Sheet>
          </>
        ) : null}
        <TrainingActions>
          <BottomButton icon={Play} to={result.passed ? paths.provider(vendorKey) : levelUrl} testId="training-exam-continue">{TRAINING_COPY.continue}</BottomButton>
        </TrainingActions>
      </TrainingInner>
    );
  }

  /* ── one question per screen ──────────────────────────────────────────── */
  if (paper && q) {
    const counter = <Chip>{TRAINING_COPY.of(index + 1, qs.length)}</Chip>;
    const text = texts[q.id] || '';
    return (
      <TrainingInner crumb={TRAINING_COPY.crumb(provider)} title={title} backTo={levelUrl} onBack={back} right={counter}>
        <div className="flex flex-col gap-3 md:max-w-[760px]">
          <QuestionDots label={TRAINING_COPY.questionOf(index + 1, qs.length)} total={qs.length} current={index} />
          {problemChip ? <div className="flex flex-wrap gap-1.5">{problemChip}</div> : null}
          <p dir="auto" className="whitespace-pre-line text-[19px] font-extrabold leading-[1.35] text-nu-surface-text rtl:font-bold rtl:leading-[2]">
            {q.question_text}
          </p>
          {paper.kind === 'grand_quiz' && (q as GQuestion).question_urdu ? (
            <p dir="rtl" lang="ur" className="text-[17px] font-semibold leading-[2] text-nu-surface-muted">{(q as GQuestion).question_urdu}</p>
          ) : null}
          {paper.kind === 'capstone' ? (
            <WrittenField
              value={text}
              floor={paper.floor}
              onChange={(v) => setTexts((t) => ({ ...t, [q.id]: v }))}
              disabled={sending}
            />
          ) : (
            <AnswerChoices
              key={q.id}
              label={TRAINING_COPY.answers}
              options={(q as GQuestion).options.map(optionText)}
              value={picks[q.id] || []}
              onChange={(v) => setPicks((p) => ({ ...p, [q.id]: v }))}
              disabled={sending}
            />
          )}
        </div>
        <TrainingActions>
          {last ? (
            <BottomButton icon={Check} onClick={submit} disabled={!answered(q.id) || sending} testId="training-exam-submit">
              {sending ? TRAINING_COPY.sending : TRAINING_COPY.submit}
            </BottomButton>
          ) : (
            <BottomButton icon={ChevronRight} iconFlips onClick={() => setIndex((i) => i + 1)} disabled={!answered(q.id)} testId="training-exam-next">
              {TRAINING_COPY.next}
            </BottomButton>
          )}
        </TrainingActions>
      </TrainingInner>
    );
  }

  /* ── the gate ─────────────────────────────────────────────────────────── */
  const locked = statusOf(gate.error) === 403;
  const left = level ? Math.max(1, (level.courses_total || 0) - (level.courses_completed || 0)) : null;
  return (
    <TrainingInner crumb={TRAINING_COPY.crumb(provider)} title={title} backTo={levelUrl}>
      {gate.loading ? <Loading /> : null}
      {locked ? <Hero title={TRAINING_COPY.locked} icon={Lock} tone="neutral" /> : null}
      {!gate.loading && gate.error && !locked ? <NotLoaded onRetry={gate.reload} /> : null}
      {!gate.loading && !gate.error && (!g || g.state === 'no_quiz') ? <Hero title={TRAINING_COPY.noExam} icon={Trophy} tone="neutral" /> : null}

      {g && g.state === 'ready' ? (
        <>
          <Hero
            title={TRAINING_COPY.ready}
            icon={g.exam_kind === 'capstone' ? PenLine : Trophy}
            tone="neutral"
            chips={(
              <>
                {g.question_count ? <Chip>{TRAINING_COPY.questions(g.question_count)}</Chip> : null}
                {g.exam_kind === 'capstone' ? <Chip icon={PenLine}>{TRAINING_COPY.writtenAnswer}</Chip> : null}
                {typeof g.pass_mark_pct === 'number' && Number.isFinite(g.pass_mark_pct) ? <Chip>{TRAINING_COPY.toPass(g.pass_mark_pct)}</Chip> : null}
                {typeof g.cooldown_hours === 'number' && g.cooldown_hours > 0 ? <Chip tone="waiting" icon={Timer}>{TRAINING_COPY.waitIfFailed(g.cooldown_hours)}</Chip> : null}
                {problemChip}
              </>
            )}
          />
          <TrainingActions>
            <BottomButton icon={Play} onClick={start} disabled={opening} testId="training-exam-start">{TRAINING_COPY.startExam}</BottomButton>
          </TrainingActions>
        </>
      ) : null}

      {g && g.state === 'courses_incomplete' ? (
        <Hero
          title={TRAINING_COPY.locked}
          icon={Lock}
          tone="neutral"
          chips={left != null ? <Chip icon={Lock}>{TRAINING_COPY.moreCourses(left)}</Chip> : undefined}
        />
      ) : null}

      {g && g.state === 'cooldown' ? (
        <Hero
          title={TRAINING_COPY.wait}
          icon={Timer}
          tone="waiting"
          chips={<Chip tone="waiting" icon={Timer}>{TRAINING_COPY.waitHours(hoursLeft(g.cooldown_until))}</Chip>}
        />
      ) : null}

      {g && g.state === 'passed' ? (
        <>
          <Hero title={TRAINING_COPY.passed} icon={Trophy} tone="done" />
          {g.certificate ? <CertificateCard certificate={g.certificate} /> : null}
        </>
      ) : null}
    </TrainingInner>
  );
}
