/**
 * "Recent lesson plans" — her last 10, any grade 1-12, newest first, at the bottom of the Lesson
 * Plans page every teacher has today (the old look; the new UI's is in newui/lessons).
 *
 * bd-k23p38 — it replaced "My lesson plans", which listed only the grades 6-12 lessons she had
 * asked for here (operator, 7 Oct 2026: "The page should show her last 10 lesson plans opened. it
 * can be 1-12, any." … "on whatsapp too."). What it lists, and how a row opens, is
 * lib/recentLessonPlans: this file only draws it.
 *
 * Each row: the grade, the title, subject · day · chapter, and how she last had it — an eye and
 * when (opened here), a chat bubble and when (sent on WhatsApp), Ready (written while she was
 * away), or Preparing (being written: first in the list, and it opens by itself if she taps it).
 * Nothing loaded, or nothing used yet: no section at all. A list that cannot load must not bury
 * the picker above it.
 */

import { BookOpen, CheckCircle2, ChevronRight, Clock, Eye, Loader2, MessageCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRecentLessonPlans, whenLabel, type RecentLessonPlan, type RecentProblem } from '../lib/recentLessonPlans';

const PROBLEM: Record<RecentProblem, { title: string; variant?: 'destructive' }> = {
  not_ready: { title: 'That lesson is not ready yet' },
  failed: { title: 'That lesson could not be written', variant: 'destructive' },
  error: { title: 'Could not open that lesson', variant: 'destructive' },
};

const detail = (p: RecentLessonPlan) => [p.subject, p.dayLabel, p.chapterTitle].filter(Boolean).join(' · ');

function Tag({ plan }: { plan: RecentLessonPlan }) {
  const when = whenLabel(plan.at);
  const base = 'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';
  if (plan.tag === 'preparing') {
    return (
      <span data-testid="recent-tag" className={`${base} bg-amber-100 text-amber-800`}>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Preparing…
      </span>
    );
  }
  if (plan.tag === 'ready') {
    return (
      <span data-testid="recent-tag" className={`${base} bg-green-100 text-green-800`}>
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ready
      </span>
    );
  }
  const whatsapp = plan.tag === 'whatsapp';
  const Icon = whatsapp ? MessageCircle : Eye;
  return (
    <span
      data-testid="recent-tag"
      title={whatsapp ? 'Sent to you on WhatsApp' : 'Opened here'}
      className={`${base} ${whatsapp ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{whatsapp ? 'On WhatsApp' : 'Opened'}</span>
      {when}
    </span>
  );
}

/** `refreshKey`: bumped by the page when she has just asked for a plan, so it is listed at once. */
const RecentLessonPlans = ({ refreshKey = 0 }: { refreshKey?: number }) => {
  const { toast } = useToast();
  const { status, plans, open } = useRecentLessonPlans({ refreshKey, onProblem: (p) => toast(PROBLEM[p]) });

  if (status !== 'ok' || plans.length === 0) return null;

  return (
    <section className="border-t mt-8 pt-6">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4" aria-hidden="true" /> Recent lesson plans
      </h3>
      <ul data-testid="recent-lesson-plans" className="rounded-lg border bg-card divide-y overflow-hidden">
        {plans.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              onClick={() => { void open(p); }}
              disabled={!p.found}
              className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold tabular-nums text-primary"
              >
                {p.grade != null ? `G${p.grade}` : <BookOpen className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span data-testid="recent-title" className="block truncate font-medium">{p.title || 'Lesson plan'}</span>
                {detail(p) ? <span className="block truncate text-xs text-muted-foreground">{detail(p)}</span> : null}
              </span>
              <Tag plan={p} />
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default RecentLessonPlans;
