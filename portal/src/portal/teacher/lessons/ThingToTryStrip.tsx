import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import { FOCUS } from '../ui/styles';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';

/**
 * v10 coaching test (bd-v0toag.8, PR2) — the one thing to try, as a strip above a grade 1–5 plan.
 *
 * Shown only when GET /teacher/thing-to-try has one for her: groups C and D while ab_v10_enabled is
 * on (dashboard/routes/portal-teacher-thing-to-try.routes.js). For everyone else, and on any failed
 * or odd answer, it renders nothing and the page is today's. A tap opens the full text and is logged
 * (POST /teacher/thing-to-try/tap); step stays null until the plan's steps are tagged (bd-v0toag.22).
 */

type Thing = { text: string; tag: string | null };

export async function loadThingToTry(lessonId: string): Promise<Thing | null> {
  try {
    const { data } = await api.get('/teacher/thing-to-try', { params: { lessonId } });
    const t = data && data.thing;
    return t && typeof t.text === 'string' && t.text.trim() ? { text: t.text, tag: t.tag ?? null } : null;
  } catch {
    return null;
  }
}

function logTap(lessonId: string) {
  try {
    void Promise.resolve(api.post('/teacher/thing-to-try/tap', { lessonId, step: null })).catch(() => {});
  } catch { /* a tap never fails for her */ }
}

export function ThingToTryStrip({ lessonId }: { lessonId: string }) {
  const C = useCopy(LESSONS);
  const [thing, setThing] = useState<Thing | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setThing(null);
    setOpen(false);
    void loadThingToTry(lessonId).then((t) => { if (live) setThing(t); });
    return () => { live = false; };
  }, [lessonId]);

  if (!thing) return null;

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => {
        setOpen((o) => !o);
        logTap(lessonId);
      }}
      className={cn('flex min-h-[56px] w-full items-start gap-3 rounded-2xl border border-[#fcd34d] bg-[#fffbeb] px-3.5 py-3 text-start', FOCUS)}
    >
      <Star className="mt-0.5 h-5 w-5 shrink-0 fill-[#f59e0b] text-[#f59e0b]" aria-hidden="true" />
      <span className="flex-1">
        <span className="block text-[13px] font-semibold text-[#92400e]">{C.thingToTry}</span>
        <span className={cn('block text-[15px] text-[#1d2025]', open ? '' : 'line-clamp-2')}>{thing.text}</span>
      </span>
    </button>
  );
}
