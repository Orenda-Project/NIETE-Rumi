import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import {
  Circle, CircleAlert, Clock, FileImage, Headphones, Lightbulb, ListChecks, Loader2, MessageCircle,
  MessageCircleQuestion, MessagesSquare, Mic, NotebookPen, RotateCcw, SearchX, Send, Sparkles, Star,
} from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import { portal, type ActiveCoachingSession } from '../../services/api';
import type { CoachingProgress, SessionDetail } from '../../types/portal';
import { scoreBandFor } from '../../lib/scoreBands';
import { parseTranscript } from '../../lib/transcript';
import { withoutScore } from '../../lib/coachingCard';
import { COACHING_COPY } from '../copy';
import { InnerBar } from '../InnerBar';
import { List, Row } from '../List';
import { Chip } from '../Chip';
import { BottomActions, BottomButton } from '../BottomButton';
import { Hero } from '../Hero';
import { Fold, Panel } from '../Panel';
import { AudioPlayer } from '../AudioPlayer';
import { FOCUS } from '../styles';
import { pkDayMonth } from '../range';
import { openFile } from '../assessment/assessmentApi';
import { BAND_TONE } from './lessonRows';

/** The step being worked on: its tile's icon turns, only when motion is allowed. */
const Spinner = forwardRef<SVGSVGElement, LucideProps>(({ className, ...props }, ref) => (
  <Loader2 ref={ref} {...props} className={cn(className, 'motion-safe:animate-spin')} />
)) as LucideIcon;
Spinner.displayName = 'Spinner';

/**
 * bd-5rz1v.26 — one lesson's page in the new UI (/portal/coaching/session/:id), picked by
 * pages/PortalCoachingDetail (portal_new_ui + self-observation, a teacher). Today's LessonPage,
 * the same reads, rebuilt from the kit — an inner page under Coaching, its topic the title:
 *
 *   on its way   a Hero for where it is (Analysing ~10 min; Making report ~1 min) and the three
 *                steps as rows (done: the green check tile; to come: dimmed). Her question,
 *                when it is ready and she sent the lesson here: the question, a box, Send. Sent
 *                on WhatsApp: "Answer on WhatsApp".
 *   the report   chips (subject, day, minutes, the band as a word); then sections, each with ONE
 *                short heading — Digital Coach (her debrief), Try next time, Went well (three),
 *                Rubric (each part's band), Your recording — and the long ones fold: Your
 *                reflection, All tips, What was said (six lines, then Show all). The Digital
 *                Coach's words are content, not UI copy: shown as they are, readable.
 *   a coach      his observation as WhatsApp delivered it (served only once he sent it): who,
 *                when, the picture, the caption and the text.
 *   elsewhere    a Next question row to the oldest OTHER lesson waiting for her answer.
 *
 * Progress is polled every 5 s for two minutes, then every 15 s, until the report is ready.
 */

const LINES_SHOWN = 6;

type StepKind = 'done' | 'work' | 'you' | 'todo';
type Step = { label: string; kind: StepKind; chip?: string };

function stepsFor(progress: CoachingProgress, answered: boolean): Step[] | null {
  const stage = answered && progress.stage === 'reflection' ? 'report' : progress.stage;
  if (stage === 'queued' || stage === 'transcribing' || stage === 'analysing') {
    return [
      { label: COACHING_COPY.stepAnalysing, kind: 'work', chip: COACHING_COPY.aboutTen },
      { label: COACHING_COPY.stepQuestion, kind: 'todo' },
      { label: COACHING_COPY.stepReport, kind: 'todo' },
    ];
  }
  if (stage === 'reflection') {
    return [
      { label: COACHING_COPY.stepAnalysed, kind: 'done' },
      { label: COACHING_COPY.stepQuestion, kind: 'you', chip: progress.source === 'whatsapp' ? COACHING_COPY.states.onWhatsApp : COACHING_COPY.states.yourAnswer },
      { label: COACHING_COPY.stepReport, kind: 'todo' },
    ];
  }
  if (stage === 'report') {
    return [
      { label: COACHING_COPY.stepAnalysed, kind: 'done' },
      { label: COACHING_COPY.stepAnswered, kind: 'done' },
      { label: COACHING_COPY.stepMaking, kind: 'work', chip: COACHING_COPY.aboutOne },
    ];
  }
  return null;
}

const dayOf = (iso: string | null | undefined) => {
  const d = iso ? pkDayMonth(iso) : null;
  return d ? `${d.day} ${d.month}` : null;
};

export default function LessonView({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<CoachingProgress | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [others, setOthers] = useState<ActiveCoachingSession[]>([]);
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [answered, setAnswered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(Date.now());

  // Progress, polled until the report is ready (or the pipeline stopped).
  const check = useCallback(async () => {
    try {
      const p = await portal.getCoachingProgress(sessionId);
      setProgress(p);
      if (p.stage === 'done') {
        const d = await portal.getCoachingSession(sessionId);
        setDetail(d.session);
        return;
      }
      if (p.stage === 'stopped') return;
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) { setMissing(true); return; }
    }
    const waited = Date.now() - startedAt.current;
    timer.current = setTimeout(() => { void check(); }, waited < 120_000 ? 5_000 : 15_000);
  }, [sessionId]);

  useEffect(() => {
    startedAt.current = Date.now();
    void check();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [check]);

  // The other lessons waiting for her answer, oldest first.
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => portal.getActiveCoachingSessions())
      .then((r) => {
        if (!live) return;
        setOthers(((r && r.sessions) || [])
          .filter((s) => s.needsAnswer && s.id !== sessionId)
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)));
      })
      .catch(() => { /* a shortcut, not the page */ });
    return () => { live = false; };
  }, [sessionId]);

  const sendAnswer = async () => {
    const text = answer.trim();
    if (!text) return;
    setSending(true);
    setSendError(false);
    try {
      await portal.submitCoachingReflection(sessionId, text);
      setAnswered(true);
      if (timer.current) clearTimeout(timer.current);
      void check();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const title = detail?.topic || (detail?.observation ? COACHING_COPY.observation : COACHING_COPY.yourLesson);
  const next = others.length > 0 ? (
    <List>
      <Row
        title={COACHING_COPY.nextQuestion}
        icon={MessageCircleQuestion}
        to={`/portal/coaching/session/${others[0].id}`}
        chips={<Chip tone="waiting">{COACHING_COPY.waiting(others.length)}</Chip>}
        testId="lesson-next-question"
      />
    </List>
  ) : null;

  const page = (body: ReactNode) => (
    <PortalLayout ownHeading>
      <InnerBar feature="coaching" crumb={COACHING_COPY.title} title={title} backTo="/portal/coaching" />
      <div className="mx-auto max-w-[1120px] px-[14px] pb-[14px] md:px-10">
        <div className="flex w-full flex-col gap-3 md:max-w-[720px]">
          {next}
          {body}
        </div>
      </div>
    </PortalLayout>
  );

  if (missing) return page(<Hero title={COACHING_COPY.notFound} icon={SearchX} />);
  if (!progress) return page(<Hero title={COACHING_COPY.loading} icon={Loader2} spinning live />);

  if (progress.stage === 'stopped') {
    return page(
      <>
        <Hero title={COACHING_COPY.notAnalysed} icon={CircleAlert} tone="error" />
        <BottomActions>
          <BottomButton icon={RotateCcw} onClick={() => navigate('/portal/coaching', { state: { sendSheet: true } })}>{COACHING_COPY.sendAgain}</BottomButton>
        </BottomActions>
      </>,
    );
  }

  const steps = stepsFor(progress, answered);
  if (steps) {
    const askHere = progress.stage === 'reflection' && !answered && progress.source !== 'whatsapp' && progress.reflection;
    return page(
      <>
        <div data-testid="lesson-steps" aria-live="polite">
          <List>
            {steps.map((s) => (
              <Row
                key={s.label}
                title={s.label}
                icon={s.kind === 'work' ? Spinner : s.kind === 'you' ? MessageCircleQuestion : s.kind === 'todo' ? Circle : undefined}
                tile={s.kind === 'done' ? 'done' : s.kind === 'todo' ? 'quiet' : 'neutral'}
                state={s.kind === 'todo' ? 'off' : undefined}
                chips={s.chip ? <Chip tone="waiting" icon={s.kind === 'work' ? Clock : undefined}>{s.chip}</Chip> : undefined}
                testId={`lesson-step-${s.kind}`}
              />
            ))}
          </List>
        </div>
        {askHere && progress.reflection ? (
          <>
            <section data-testid="lesson-question" className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card p-4">
              <p className="text-lg font-bold leading-snug text-nu-surface-text rtl:leading-[2]" dir="auto">{progress.reflection.question}</p>
              <textarea
                dir="auto"
                aria-label={COACHING_COPY.yourAnswer}
                placeholder={COACHING_COPY.yourAnswer}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                className={`min-h-[160px] w-full resize-none rounded-xl border-[1.5px] border-nu-surface-line bg-nu-surface-card p-3.5 text-[17px] text-nu-surface-text focus:border-nu-select ${FOCUS}`}
              />
              {sendError ? <div className="flex justify-center"><Chip tone="error" icon={CircleAlert}>{COACHING_COPY.notSent}</Chip></div> : null}
            </section>
            <BottomActions>
              <BottomButton icon={Send} iconFlips disabled={!answer.trim() || sending} onClick={() => { void sendAnswer(); }}>
                {COACHING_COPY.sendAnswer}
              </BottomButton>
            </BottomActions>
          </>
        ) : null}
        {progress.stage === 'reflection' && progress.source === 'whatsapp' ? (
          <List><Row title={COACHING_COPY.answerOnWhatsApp} icon={MessageCircle} /></List>
        ) : null}
      </>,
    );
  }

  if (!detail) return page(<Hero title={COACHING_COPY.loading} icon={Loader2} spinning live />);

  // A coach's observation: the report exactly as WhatsApp delivered it, and who observed her.
  if (detail.observation) {
    const o = detail.observation;
    const observed = dayOf(o.observedAt);
    return page(
      <>
        <div data-testid="lesson-chips" className="flex flex-wrap gap-1.5">
          <Chip>{COACHING_COPY.coachVisit}</Chip>
          {o.observerName ? <Chip>{o.observerName}</Chip> : null}
          {observed ? <Chip>{observed}</Chip> : null}
          {o.sentAt ? <Chip tone="done" icon={MessageCircle}>{COACHING_COPY.sent}</Chip> : null}
        </div>
        <section data-testid="observation-report" className="flex flex-col gap-3 overflow-hidden rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card p-2.5">
          {o.reportImageUrl ? <img src={o.reportImageUrl} alt={COACHING_COPY.sections.report} className="w-full rounded-xl" /> : null}
          {o.caption ? <p className="whitespace-pre-line px-1.5 text-base leading-relaxed text-nu-surface-text rtl:leading-[2]" dir="auto">{o.caption}</p> : null}
          {o.companionText ? <p className="whitespace-pre-line px-1.5 pb-1.5 text-base leading-relaxed text-nu-surface-text rtl:leading-[2]" dir="auto">{o.companionText}</p> : null}
        </section>
      </>,
    );
  }

  return page(<Report detail={detail} />);
}

function Report({ detail }: { detail: SessionDetail }) {
  const [allLines, setAllLines] = useState(false);
  const data = detail.analysisData || ({} as SessionDetail['analysisData']);
  const tips = (data.recommendations || []).filter(Boolean);
  const tryNext = detail.prioritizedAction?.action ? withoutScore(detail.prioritizedAction.action) : tips[0] || null;
  const strengths = (data.strengths || []).filter(Boolean);
  const reflections = (detail.reflection || []).filter((r) => r.question || r.answer);
  const groups = detail.breakdown?.groups || [];
  const lines = parseTranscript(detail.transcript);
  const band = scoreBandFor(detail.percentage);
  const day = dayOf(detail.date);
  const mins = detail.duration && detail.duration > 0 ? Math.max(1, Math.round(detail.duration / 60)) : null;
  const text = 'text-base leading-relaxed text-nu-surface-text rtl:leading-[2]';

  return (
    <div data-testid="lesson-report" className="flex flex-col gap-3">
      <div data-testid="lesson-chips" className="flex flex-wrap gap-1.5">
        {detail.subject ? <Chip>{detail.subject}</Chip> : null}
        {day ? <Chip>{day}</Chip> : null}
        {mins ? <Chip>{COACHING_COPY.minutes(mins)}</Chip> : null}
        {band ? <Chip tone={BAND_TONE[band]}>{COACHING_COPY.bands[band]}</Chip> : null}
      </div>

      {detail.debriefAudioUrl ? (
        <Panel icon={Headphones} title={COACHING_COPY.sections.digitalCoach}>
          <AudioPlayer bare src={detail.debriefAudioUrl} label={COACHING_COPY.sections.digitalCoach} />
        </Panel>
      ) : null}

      {tryNext ? (
        <Panel icon={Lightbulb} title={COACHING_COPY.sections.tryNext}>
          <p className={text} dir="auto">{tryNext}</p>
        </Panel>
      ) : null}

      {strengths.length > 0 ? (
        <Panel icon={Star} title={COACHING_COPY.sections.wentWell}>
          <ul className={`flex list-disc flex-col gap-1.5 ps-5 ${text}`}>
            {strengths.slice(0, 3).map((s) => <li key={s} dir="auto">{s}</li>)}
          </ul>
        </Panel>
      ) : null}

      {groups.length > 0 ? (
        <Panel icon={ListChecks} title={COACHING_COPY.sections.rubric}>
          <ul className="flex flex-col">
            {groups.map((g) => {
              const b = scoreBandFor(g.pct);
              return (
                <li key={g.key} className="flex min-h-[44px] items-center justify-between gap-3 border-b-[1.5px] border-nu-surface-line py-2 last:border-b-0">
                  <span className="text-[15px] font-semibold text-nu-surface-text rtl:leading-[2]" dir="auto">{g.name}</span>
                  {b ? <Chip tone={BAND_TONE[b]}>{COACHING_COPY.bands[b]}</Chip> : null}
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      {detail.lessonAudioUrl ? (
        <Panel icon={Mic} title={COACHING_COPY.sections.recording}>
          {/* Her lesson's length is known, so the total shows before anything is fetched. */}
          <AudioPlayer bare src={detail.lessonAudioUrl} label={COACHING_COPY.sections.recording} durationHint={detail.duration} />
        </Panel>
      ) : null}

      {reflections.length > 0 ? (
        <Fold icon={NotebookPen} title={COACHING_COPY.sections.reflection}>
          <div className="flex flex-col gap-3">
            {reflections.map((r, i) => (
              <div key={i} className="flex flex-col gap-1">
                {r.question ? <p className="text-[15px] font-bold text-nu-surface-text" dir="auto">{r.question}</p> : null}
                {r.answer ? <p className="text-[15px] text-nu-surface-muted" dir="auto">{r.answer}</p> : null}
              </div>
            ))}
          </div>
        </Fold>
      ) : null}

      {tips.length > 1 ? (
        <Fold icon={Sparkles} title={COACHING_COPY.sections.allTips}>
          <ul className={`flex list-disc flex-col gap-1.5 ps-5 ${text}`}>{tips.map((t) => <li key={t} dir="auto">{t}</li>)}</ul>
        </Fold>
      ) : null}

      {lines.length > 0 ? (
        <Fold icon={MessagesSquare} title={COACHING_COPY.sections.said} testId="transcript">
          <div className="flex flex-col gap-2.5">
            {(allLines ? lines : lines.slice(0, LINES_SHOWN)).map((l, i) => (
              <div key={i} data-testid="transcript-line" className="flex flex-col gap-1">
                {l.who || l.at ? (
                  <span className="flex items-center gap-2">
                    {l.who ? <Chip>{l.who}</Chip> : null}
                    {l.at ? <span className="text-xs text-nu-surface-muted">{l.at}</span> : null}
                  </span>
                ) : null}
                <p className="text-[15px] leading-relaxed text-nu-surface-text rtl:leading-[2]" dir="auto">{l.text}</p>
              </div>
            ))}
            {lines.length > LINES_SHOWN && !allLines ? (
              <BottomButton tone="outline" onClick={() => setAllLines(true)}>{COACHING_COPY.showAll}</BottomButton>
            ) : null}
          </div>
        </Fold>
      ) : null}

      {detail.reportUrl ? (
        <List>
          <Row title={COACHING_COPY.reportPicture} icon={FileImage} onClick={() => openFile(detail.reportUrl as string)} />
        </List>
      ) : null}
    </div>
  );
}
