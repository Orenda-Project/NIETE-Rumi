import { BookOpen, Check, Eye, Loader2, MessageCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useRecentLessonPlans, whenLabel, type RecentLessonPlan, type RecentProblem,
} from '../../lib/recentLessonPlans';
import { LESSONS_COPY } from '../copy';
import { List, Row, SectionLabel } from '../List';
import { Chip } from '../Chip';
import { subjectIcon } from './shared';

/**
 * bd-k23p38 — Recent on the new Lesson Plans main page, under the four rows: her last 10 plans,
 * any grade 1–12, newest first (it replaced the band's "Last: …" chip, which showed one).
 *
 * The same list as the old page's Recent lesson plans (components/RecentLessonPlans.tsx), from
 * the same place (lib/recentLessonPlans); this draws it with the kit. A row: the grade in the
 * tile, the title, the subject, and how she last had it — an eye and when (opened here), a chat
 * bubble and when (sent on WhatsApp, green), Ready (written while she was away) or Preparing… (being
 * written: first, and it opens by itself when she taps it). Nothing loaded or nothing yet: none.
 */

const COPY = LESSONS_COPY.recent;

function how(p: RecentLessonPlan): string {
  if (p.tag === 'preparing') return LESSONS_COPY.preparing;
  if (p.tag === 'ready') return COPY.ready;
  return p.tag === 'whatsapp' ? COPY.onWhatsApp : COPY.opened;
}

function Tag({ plan, when }: { plan: RecentLessonPlan; when: string | null }) {
  if (plan.tag === 'preparing') return <Chip tone="waiting" icon={Loader2}>{LESSONS_COPY.preparing}</Chip>;
  if (plan.tag === 'ready') return <Chip tone="done" icon={Check}>{COPY.ready}</Chip>;
  const whatsapp = plan.tag === 'whatsapp';
  return (
    <Chip tone={whatsapp ? 'done' : 'info'} icon={whatsapp ? MessageCircle : Eye}>
      {when ?? how(plan)}
    </Chip>
  );
}

function RecentRow({ plan, onOpen }: { plan: RecentLessonPlan; onOpen: () => void }) {
  const title = plan.title || LESSONS_COPY.planFallback;
  const when = plan.tag === 'opened' || plan.tag === 'whatsapp' ? whenLabel(plan.at, Date.now(), COPY.when) : null;
  return (
    <Row
      testId={`lp-recent-${plan.key}`}
      title={title}
      lead={plan.grade != null ? COPY.grade(plan.grade) : undefined}
      icon={plan.grade != null ? undefined : BookOpen}
      ariaLabel={[title, how(plan), when].filter(Boolean).join(', ')}
      onClick={plan.found ? onOpen : undefined}
      chips={(
        <>
          {plan.subject ? <Chip icon={subjectIcon(plan.subject)}>{plan.subject}</Chip> : null}
          <Tag plan={plan} when={when} />
        </>
      )}
    />
  );
}

const PROBLEM: Record<RecentProblem, { title: string; variant?: 'destructive' }> = {
  not_ready: { title: LESSONS_COPY.notReady },
  failed: { title: LESSONS_COPY.notPrepared, variant: 'destructive' },
  error: { title: LESSONS_COPY.couldNotOpen, variant: 'destructive' },
};

export function RecentPlans() {
  const { toast } = useToast();
  const { status, plans, open } = useRecentLessonPlans({
    fallbackTitle: LESSONS_COPY.planFallback,
    onProblem: (p) => toast(PROBLEM[p]),
  });
  if (status !== 'ok' || plans.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" data-testid="lp-recent">
      <SectionLabel>{COPY.label}</SectionLabel>
      <List>
        {plans.map((p) => (
          <RecentRow
            key={p.key}
            plan={p}
            onOpen={() => { void open(p, { crumb: LESSONS_COPY.crumb(p.dayLabel ?? p.chapterTitle) }); }}
          />
        ))}
      </List>
    </section>
  );
}
