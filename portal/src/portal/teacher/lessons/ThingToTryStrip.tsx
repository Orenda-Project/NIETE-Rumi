import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import { FOCUS } from '../ui/styles';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';

/**
 * v10 coaching test (bd-v0toag.8, PR2) — the one thing to try, as a strip above a grade 1–5 plan.
 * Loud since bd-v0toag.77 (Amena, 16 Oct): solid amber, a thick edge and a shadow, the star in a dark badge.
 *
 * Shown only when GET /teacher/thing-to-try has one for her: groups C and D while ab_v10_enabled is
 * on (dashboard/routes/portal-teacher-thing-to-try.routes.js). For everyone else, and on any failed
 * or odd answer, it renders nothing and the page is today's. A tap opens the full text and is logged
 * (POST /teacher/thing-to-try/tap).
 *
 * PR3 — the step the move belongs to (Opening, Explanation, We Do, You Do, Check: the report card's five) comes
 * with it. Its name shows beside the label (the plan's own heading, so no new words), the page is told its
 * number (onStep) so the viewer can outline that heading, and the tap that opens the strip takes her there
 * (onShowStep) and logs the number. Never on its own: the page does not move until she taps.
 */

type Step = { name: string; index: number };
type Thing = { text: string; tag: string | null; step: Step | null };

const stepOf = (v: unknown): Step | null => {
  const s = v as Partial<Step> | null | undefined;
  return s && typeof s.name === 'string' && s.name.trim() && Number.isInteger(s.index) && (s.index as number) >= 1 && (s.index as number) <= 5
    ? { name: s.name.trim(), index: s.index as number }
    : null;
};

export async function loadThingToTry(lessonId: string): Promise<Thing | null> {
  try {
    const { data } = await api.get('/teacher/thing-to-try', { params: { lessonId } });
    const t = data && data.thing;
    return t && typeof t.text === 'string' && t.text.trim() ? { text: t.text, tag: t.tag ?? null, step: stepOf(t.step) } : null;
  } catch {
    return null;
  }
}

function logTap(lessonId: string, step: number | null) {
  try {
    void Promise.resolve(api.post('/teacher/thing-to-try/tap', { lessonId, step })).catch(() => {});
  } catch { /* a tap never fails for her */ }
}

export function ThingToTryStrip({ lessonId, onStep, onShowStep }: {
  lessonId: string;
  onStep?: (index: number | null) => void;
  onShowStep?: () => void;
}) {
  const C = useCopy(LESSONS);
  const [thing, setThing] = useState<Thing | null>(null);
  const [open, setOpen] = useState(false);
  const tell = useRef(onStep);
  tell.current = onStep;

  useEffect(() => {
    let live = true;
    setThing(null);
    setOpen(false);
    void loadThingToTry(lessonId).then((t) => {
      if (!live) return;
      setThing(t);
      tell.current?.(t?.step?.index ?? null);
    });
    return () => { live = false; };
  }, [lessonId]);

  if (!thing) return null;

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => {
        if (!open && thing.step) onShowStep?.();
        setOpen(!open);
        logTap(lessonId, thing.step?.index ?? null);
      }}
      className={cn('flex min-h-[56px] w-full items-start gap-3 rounded-2xl border-[3px] border-[#b45309] bg-[#fbbf24] px-3.5 py-3 text-start shadow-[0_4px_14px_rgba(180,83,9,0.35)]', FOCUS)}
    >
      <span data-testid="strip-star" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#b45309] ring-2 ring-white" aria-hidden="true">
        <Star className="h-6 w-6 fill-white text-white" />
      </span>
      <span className="flex-1">
        <span className="block text-[14px] font-bold uppercase tracking-wide text-[#451a03]">
          {C.thingToTry}
          {thing.step ? <span className="font-normal" dir="ltr"> · {thing.step.name}</span> : null}
        </span>
        <span className={cn('block text-[16px] font-semibold text-[#1d2025]', open ? '' : 'line-clamp-2')}>{thing.text}</span>
      </span>
    </button>
  );
}
