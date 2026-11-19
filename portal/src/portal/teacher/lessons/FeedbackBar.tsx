import { useEffect, useRef, useState } from 'react';
import { CalendarClock, CircleCheck, Hourglass, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RatingScale, StatusChip, TextLine } from '../ui';
import { CARD, FOCUS, OUTLINE_WIDE, PRIMARY_WIDE, ROW_TITLE } from '../ui/styles';
import { useCopy } from '../i18n';
import { FEEDBACK } from './feedbackCopy';
import {
  REASON_MAX, fetchPlanFeedback, savePlanFeedback,
  type FeedbackAnswer, type FeedbackPlan, type PlanFeedback, type UsedInClass,
} from './feedbackApi';

/**
 * The survey bar at the end of a lesson plan in the viewer (spec §1, option A): in the page flow, never a pop-up.
 *
 *   This plan    Useful · Not useful (one tap saves her answer: one row for her and this plan)
 *   In class     after Useful: Taught it today · Planning to · Not yet (the same row) → Thanks
 *   Thanks       after Not useful at once, with What was wrong under it; Send once it has words (the same row)
 *
 * Answered earlier (in the app or on WhatsApp) → nothing; Useful earlier with no In class → straight at In class. A save
 * that fails keeps the state before the tap with Not saved (or No internet) and Try again, which re-sends that tap.
 * Never a spinner: while saving the tapped choice shows picked, the others are off, the card is aria-busy. The switch
 * off on the server (404) or a state that cannot be read → no bar. Shown by the viewer only where it belongs.
 */
type Phase = 'loading' | 'hidden' | 'useful' | 'inClass' | 'thanks';
type Problem = 'notSaved' | 'noInternet' | null;

const phaseFor = (f: PlanFeedback | null): Phase => {
  if (!f) return 'useful';
  return f.useful && !f.usedInClass ? 'inClass' : 'hidden';
};

export function FeedbackBar({ plan }: { plan: FeedbackPlan }) {
  const C = useCopy(FEEDBACK);
  const [phase, setPhase] = useState<Phase>('loading');
  const [picked, setPicked] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const last = useRef<{ answer: FeedbackAnswer; pick: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    void fetchPlanFeedback(plan).then((f) => { if (live) setPhase(f === 'off' ? 'hidden' : phaseFor(f)); });
    return () => { live = false; };
  }, [plan.kind, plan.ref]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(answer: FeedbackAnswer, pick: string | null) {
    if (saving.current) return;
    saving.current = true;
    last.current = { answer, pick };
    setBusy(true);
    setPicked(pick);
    setProblem(null);
    const out = await savePlanFeedback(plan, answer);
    saving.current = false;
    setBusy(false);
    setPicked(null);
    if ('reason' in out) {
      if (out.reason === 'gone') setPhase('hidden');
      else setProblem(out.reason === 'offline' ? 'noInternet' : 'notSaved');
      return;
    }
    last.current = null;
    if ('stale' in out && out.stale) { // bd-m8zwt1.15 — the plan was answered in another tab: show what is saved
      setReasonOpen(false);
      setPhase(out.feedback?.useful && !out.feedback.usedInClass ? 'inClass' : 'thanks');
      return;
    }
    if ('useful' in answer) {
      if (answer.useful) setPhase('inClass');
      else { setPhase('thanks'); setReasonOpen(true); }
    } else if ('usedInClass' in answer) {
      setPhase('thanks');
    } else {
      setReasonOpen(false);
    }
  }

  if (phase === 'loading' || phase === 'hidden') return null;

  return (
    <section className={cn(CARD, 'flex flex-col gap-3 p-4')} aria-busy={busy} data-testid="lp-feedback">
      {phase === 'useful' ? (
        <>
          <h2 className={cn(ROW_TITLE, 'text-[#1d2025]')}>{C.thisPlan}</h2>
          <RatingScale
            name={C.thisPlan}
            value={picked}
            disabled={busy}
            options={[{ id: 'yes', text: C.useful, icon: ThumbsUp }, { id: 'no', text: C.notUseful, icon: ThumbsDown }]}
            onChange={(k) => { void send({ useful: k === 'yes' }, String(k)); }}
          />
        </>
      ) : null}
      {phase === 'inClass' ? (
        <>
          <h2 className={cn(ROW_TITLE, 'text-[#1d2025]')}>{C.inClass}</h2>
          <RatingScale
            stacked
            name={C.inClass}
            value={picked}
            disabled={busy}
            options={[
              { id: 'taught', text: C.taught, icon: CircleCheck },
              { id: 'planned', text: C.planned, icon: CalendarClock },
              { id: 'not_yet', text: C.notYet, icon: Hourglass },
            ]}
            onChange={(k) => { void send({ usedInClass: k as UsedInClass }, String(k)); }}
          />
        </>
      ) : null}
      {phase === 'thanks' ? <StatusChip tone="done" tick text={C.thanks} className="self-start" /> : null}
      {phase === 'thanks' && reasonOpen ? (
        <>
          <TextLine label={C.whatWrong} value={reason} onChange={setReason} maxLength={REASON_MAX} testId="lp-feedback-reason" />
          {reason.trim() ? (
            <button type="button" disabled={busy} className={cn(PRIMARY_WIDE, 'disabled:opacity-50', FOCUS)}
              onClick={() => { void send({ reasonText: reason.trim() }, null); }}>
              {C.send}
            </button>
          ) : null}
        </>
      ) : null}
      {problem ? (
        <>
          <StatusChip tone="error" text={problem === 'noInternet' ? C.noInternet : C.notSaved} className="self-start" />
          <button type="button" disabled={busy} className={cn(OUTLINE_WIDE, FOCUS)}
            onClick={() => { if (last.current) void send(last.current.answer, last.current.pick); }}>
            {C.tryAgain}
          </button>
        </>
      ) : null}
    </section>
  );
}
