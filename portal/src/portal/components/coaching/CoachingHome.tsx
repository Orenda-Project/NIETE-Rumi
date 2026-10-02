import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Loader2, Search, TrendingUp } from 'lucide-react';
import LoadingState from '../LoadingState';
import RecordIcon from './RecordIcon';
import NeedsAnswerBanner from './NeedsAnswerBanner';
import { portal } from '../../services/api';
import type { ActiveCoachingSession } from '../../services/api';
import type { CoachingSession } from '../../types/portal';
import { scoreBandFor, bandLabel, type BandKey } from '../../lib/scoreBands';
import { useToast } from '@/hooks/use-toast';

/**
 * bd-5rz1v — the Coaching page, redesigned for teachers who are not confident
 * with phones (behind portal_self_observation; everyone else keeps the old one).
 *
 *   needs-your-answer banner   right under the navigation; Answer → the OLDEST one
 *   Record your class          one big animated button, the page's main action
 *   Analysing N lessons…       a quiet line, not a card
 *   Your recordings            search, subject, newest first, grouped by month;
 *                              lessons still in flight are rows in the same list
 */

const COPY = {
  title: 'Coaching',
  analytics: 'Analytics',
  record: 'Record your class',
  recordSub: 'Your Digital Coach listens and gives you tips.',
  needs: (n: number) => (n === 1 ? '1 lesson needs your answer' : `${n} lessons need your answer`),
  answer: 'Answer',
  analysing: (n: number) => `Analysing ${n} lesson${n === 1 ? '' : 's'}. Ready in about 10 minutes.`,
  recordings: 'Your recordings',
  search: 'Search by topic or subject',
  all: 'All',
  showMore: 'Show more',
  newRecording: 'New recording',
  sent: (d: Date) => `Sent ${sameDay(d, new Date()) ? 'today' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
  needsAnswer: 'Needs your answer',
  answerOnWhatsApp: 'Answer on WhatsApp',
  analysingBadge: 'Analysing',
  notRated: 'Not rated',
  noMatch: 'No recordings match.',
  steps: [
    ['1', 'Record your class. Put your phone on the table.'],
    ['2', 'Answer one question about your lesson.'],
    ['3', 'Get your tips from your Digital Coach.'],
  ] as const,
  loadFailed: 'Could not load your recordings. Please try again.',
};

const PAGE = 10;

/** One badge colour per state, shared with the design: navy = needs her. */
const BADGE: Record<BandKey | 'needs' | 'checking' | 'none', string> = {
  excellent: 'bg-[#e3f4ea] text-[#1b6b43]',
  good: 'bg-[#e4eef7] text-[#22577a]',
  average: 'bg-[#faf0d7] text-[#7a5600]',
  below_average: 'bg-[#fbe7dc] text-[#9a3f16]',
  needs_support: 'bg-[#fbe7dc] text-[#9a3f16]',
  needs: 'bg-primary text-white',
  checking: 'bg-[#eef0f4] text-[#5b6170]',
  none: 'bg-[#eef0f4] text-[#5b6170]',
};

type Row = {
  id: string;
  at: Date;
  topic: string;
  subject: string | null;
  sub: string;
  badge: { label: string; tone: keyof typeof BADGE };
};

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthLabel(d: Date) {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function fromDone(s: CoachingSession): Row {
  const band = scoreBandFor(s.percentage);
  const at = new Date(s.date);
  return {
    id: s.id,
    at,
    topic: s.topic || 'Your lesson',
    subject: s.subject || null,
    sub: s.subject || at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    badge: band ? { label: bandLabel(band) as string, tone: band } : { label: COPY.notRated, tone: 'none' },
  };
}

function fromActive(a: ActiveCoachingSession): Row {
  const at = new Date(a.createdAt);
  const badge = a.needsAnswer
    ? { label: COPY.needsAnswer, tone: 'needs' as const }
    : a.stage === 'reflection' && a.source === 'whatsapp'
      ? { label: COPY.answerOnWhatsApp, tone: 'checking' as const }
      : { label: COPY.analysingBadge, tone: 'checking' as const };
  return {
    id: a.id,
    at,
    topic: a.topic || COPY.newRecording,
    subject: a.subject || null,
    sub: a.subject || COPY.sent(at),
    badge,
  };
}

const CoachingHome = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState<CoachingSession[]>([]);
  const [active, setActive] = useState<ActiveCoachingSession[]>([]);
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let live = true;
    (async () => {
      // Promise.resolve().then: a client that throws synchronously is a failed
      // read like any other, never a page stuck on its spinner.
      const [d, a] = await Promise.allSettled([
        Promise.resolve().then(() => portal.getCoachingSessions(1, 100)),
        Promise.resolve().then(() => portal.getActiveCoachingSessions()),
      ]);
      if (!live) return;
      if (d.status === 'fulfilled') setDone(d.value.sessions || []);
      if (a.status === 'fulfilled') setActive((a.value && a.value.sessions) || []);
      if (d.status === 'rejected') toast({ title: COPY.loadFailed, variant: 'destructive' });
      setLoading(false);
    })();
    return () => { live = false; };
  }, [toast]);

  // A lesson can be in both lists for a moment as it finishes; the finished one wins.
  const rows = useMemo(() => {
    const doneIds = new Set(done.map((s) => s.id));
    return [...done.map(fromDone), ...active.filter((a) => !doneIds.has(a.id)).map(fromActive)]
      .sort((x, y) => y.at.getTime() - x.at.getTime());
  }, [done, active]);

  const waiting = useMemo(
    () => active.filter((a) => a.needsAnswer).sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1)),
    [active],
  );
  const analysingCount = active.filter((a) => !a.needsAnswer && a.stage !== 'reflection' && a.stage !== 'report').length;

  const subjects = useMemo(
    () => [...new Set(rows.map((r) => r.subject).filter((s): s is string => !!s))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (!subject || r.subject === subject)
      && (!q || r.topic.toLowerCase().includes(q) || (r.subject || '').toLowerCase().includes(q)));
  }, [rows, query, subject]);

  const visible = filtered.slice(0, shown);
  const groups: { label: string; rows: Row[] }[] = [];
  for (const r of visible) {
    const label = monthLabel(r.at);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.rows.push(r); else groups.push({ label, rows: [r] });
  }

  if (loading) return <LoadingState type="full" />;

  return (
    <>
      {waiting.length > 0 && (
        <NeedsAnswerBanner text={COPY.needs(waiting.length)} action={COPY.answer} to={`/portal/coaching/session/${waiting[0].id}`} />
      )}
    <div className="mx-auto max-w-5xl">

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-light sm:text-4xl">{COPY.title}</h1>
        <Link to="/portal/coaching/analytics" aria-label={COPY.analytics}
          className="flex h-11 items-center gap-2 rounded-lg px-3 text-primary hover:bg-white">
          <TrendingUp className="h-5 w-5" aria-hidden="true" />
          <span className="hidden text-sm font-semibold sm:inline">{COPY.analytics}</span>
        </Link>
      </div>

      <Link
        to="/portal/coaching/new"
        data-testid="record-your-class"
        className="flex flex-col items-center gap-3.5 rounded-[20px] border-[3px] border-primary bg-[#e3f4ea] px-5 py-7 text-center text-primary no-underline shadow-[0_4px_14px_rgba(51,55,72,0.10)] sm:flex-row sm:gap-7 sm:px-8 sm:text-left"
      >
        <RecordIcon size={104} />
        <span className="flex flex-col gap-1.5">
          <span className="text-[26px] font-bold sm:text-3xl">{COPY.record}</span>
          <span className="text-base text-[#3a4a42] sm:text-lg">{COPY.recordSub}</span>
        </span>
      </Link>

      {analysingCount > 0 && (
        <div className="mt-3.5 flex items-center gap-2 px-1 text-sm text-[#5b6170]">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          <span>{COPY.analysing(analysingCount)}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <ol className="mt-6 grid gap-3 sm:grid-cols-3">
          {COPY.steps.map(([n, text]) => (
            <li key={n} className="flex items-center gap-3 rounded-xl bg-white p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-white">{n}</span>
              <span className="text-base">{text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <section className="mt-6 flex flex-col gap-2.5">
          <h2 className="text-[19px] font-semibold">{COPY.recordings}</h2>
          <label className="flex h-12 items-center gap-2 rounded-[10px] border border-[#d6d9de] bg-white px-3">
            <Search className="h-[18px] w-[18px] text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Search recordings</span>
            <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
              placeholder={COPY.search} className="h-11 flex-1 bg-transparent text-base outline-none" />
          </label>
          {subjects.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              {[null, ...subjects].map((s) => {
                const on = subject === s;
                return (
                  <button key={s || 'all'} type="button" aria-pressed={on} onClick={() => { setSubject(s); setShown(PAGE); }}
                    className={`h-11 shrink-0 rounded-full border px-4 text-[15px] ${on ? 'border-primary bg-primary font-semibold text-white' : 'border-[#d6d9de] bg-white text-primary'}`}>
                    {s || COPY.all}
                  </button>
                );
              })}
            </div>
          )}

          <div data-testid="recordings-list" className="flex flex-col gap-2.5">
            {visible.length === 0 && <div className="py-4 text-[15px] text-muted-foreground">{COPY.noMatch}</div>}
            {groups.map((g) => (
              <div key={g.label} className="flex flex-col gap-2.5">
                <div className="mt-1 text-sm font-semibold text-primary">{g.label}</div>
                {g.rows.map((r) => (
                  <Link key={r.id} to={`/portal/coaching/session/${r.id}`}
                    className="flex items-center gap-3 rounded-xl border border-[#e5e7eb] bg-white p-3.5 text-[#1d2129] no-underline">
                    <div className="w-11 shrink-0 text-center">
                      <div className="text-[19px] font-bold leading-none">{r.at.getDate()}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{r.at.toLocaleDateString('en-US', { month: 'short' })}</div>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-base font-semibold" dir="auto">{r.topic}</span>
                      <span className="text-sm text-muted-foreground">{r.sub}</span>
                      <span><span className={`inline-block rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${BADGE[r.badge.tone]}`}>{r.badge.label}</span></span>
                    </div>
                    <ChevronRight className="h-[22px] w-[22px] shrink-0 text-[#9aa0aa]" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            ))}
          </div>

          {filtered.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)}
              className="h-[52px] rounded-[10px] border border-primary bg-white text-base font-semibold text-primary">
              {COPY.showMore}
            </button>
          )}
        </section>
      )}
    </div>
    </>
  );
};

export default CoachingHome;
