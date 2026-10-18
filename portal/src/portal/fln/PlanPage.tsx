/**
 * bd-t7zk3t.11 — the plan page, `/portal/fln/p/:id` (DESIGN v2 §2 S4/S5, §5, §7; contracts api.md + player.md v2).
 *
 * Top → bottom: back bar · navy header · goal + "Full details" · time bar · the sound grid (always visible, never on a
 * screener) · every section as a CLOSED band (operator decision) · homework band · footer. The chrome speaks the
 * user's language (`useFln().lang`); the plan's own text keeps the plan's `lang`/`dir`.
 *
 * - The plan is fetched with `flnApi.plan(id)`; 404 → "This lesson isn't available"; 503/5xx → the calm line + retry.
 *   The client NEVER logs an open — the server logs it on the plan GET, after its 404 check.
 * - ONE player per page, created HERE (`useFlnPlayer(plan)`, above the grid and the sections: it registers every clip
 *   during render, so the grid's first warm is not dropped), shared through `<FlnPlayerProvider>`. Stop-on-hide lives
 *   in the player's hook; this page only flushes telemetry on hide.
 * - Player events get the plan id and go to `flnApi.events` in batches: at most one batch per 5 s, flushed on pagehide.
 * - Which bands are open lives here (keyed by section index), so it survives a sound playing, and is mirrored to
 *   `history.state` with replaceState so Back/forward restores it.
 * - Back: an in-app previous entry → navigate(-1); opened by a link → the level list of the plan's subject for the
 *   first grade of its level (`placement[0].grades[0]`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { flnApi } from './api';
import { useFln } from './FlnContext';
import { FlnPlayerProvider, SoundGrid, gridClips, useFlnPlayer } from './player';
import { Details } from './plan/Details';
import { Header } from './plan/Header';
import { Section } from './plan/Section';
import { TimeBar } from './plan/TimeBar';
import { Chrome } from './plan/text';
import { flnStrings, type FlnLang } from './strings';
import type { FlnMe, FlnPlacement, FlnPlanResponse } from './types';
import './plan/plan.css';

const BATCH_MS = 5000;
const LESSONS_HOME = '/portal/teacher/lessons';

type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'unavailable' }
  | { state: 'ready'; data: FlnPlanResponse };

type QueuedEvent = { kind: string; plan: number | string; clip?: string; ms?: number; result?: string };

/** Where Back goes when the plan was opened by a link (no list behind it in history). */
export function linkBackTarget(subject: string | undefined, placement: FlnPlacement[] | undefined): string {
  const p = placement?.[0];
  const sub = p?.subject ?? subject;
  if (!sub) return LESSONS_HOME;
  const grade = p?.grades?.[0];
  return `/portal/fln/list/${sub}?grade=${grade && grade >= 1 && grade <= 5 ? grade : 6}`;
}

function readOpen(planId: number): Set<number> {
  try {
    const st = window.history.state as { flnOpen?: { plan: number; open: number[] } } | null;
    if (st?.flnOpen && st.flnOpen.plan === planId && Array.isArray(st.flnOpen.open)) return new Set(st.flnOpen.open);
  } catch { /* no history state */ }
  return new Set();
}

function writeOpen(planId: number, open: Set<number>) {
  try {
    const prev = (window.history.state as Record<string, unknown> | null) ?? {};
    window.history.replaceState({ ...prev, flnOpen: { plan: planId, open: [...open].sort((a, b) => a - b) } }, '');
  } catch { /* history not writable: the state still lives in memory */ }
}

/** The telemetry batcher: ≤1 POST per 5 s; flush on pagehide / hidden / unmount. */
function useEventBatch() {
  const queue = useRef<QueuedEvent[]>([]);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!queue.current.length) return;
    const batch = queue.current.splice(0, 50);
    last.current = Date.now();
    flnApi.events(batch);
    if (queue.current.length) timer.current = setTimeout(flush, BATCH_MS);
  }, []);
  const push = useCallback((e: QueuedEvent) => {
    queue.current.push(e);
    if (timer.current) return;
    timer.current = setTimeout(flush, Math.max(0, last.current + BATCH_MS - Date.now()));
  }, [flush]);
  useEffect(() => {
    const onHide = () => flush();
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, [flush]);
  return push;
}

export function PlanScreen({ me, lang }: { me: FlnMe; lang: FlnLang }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const s = flnStrings(lang);
  const rtl = lang === 'ur';
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const planId = Number(id);

  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    flnApi.plan(id).then(
      (data) => { if (live) setLoad(data && data.plan ? { state: 'ready', data } : { state: 'missing' }); },
      // 503/5xx/network (FlnUnavailableError) and anything unexpected: the calm line + retry. 401 is FlnGate's.
      () => { if (live) setLoad({ state: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [id, attempt]);

  const data = load.state === 'ready' ? load.data : null;
  const plan = data?.plan ?? null;
  // ONE player for the page, created here, above the grid and the sections (audio's wiring rule 1).
  const player = useFlnPlayer(plan);

  const push = useEventBatch();
  const planRef = useRef<number | string>(planId);
  planRef.current = plan?.id ?? planId;
  useEffect(() => player.onEvent((e) => push({ ...e, plan: planRef.current })), [player, push]);

  const [open, setOpen] = useState<Set<number>>(() => readOpen(planId));
  const toggle = useCallback((i: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      writeOpen(planId, next);
      return next;
    });
  }, [planId]);

  const placement = data?.placement ?? [];
  const screener = placement.some((p) => p.label === 'screener');
  const hasGrid = useMemo(() => !!plan && !screener && gridClips(plan).length > 0, [plan, screener]);

  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(linkBackTarget(plan?.subject, placement));
  };

  const shareClass = me.share ? ' fln-plan--share' : '';
  const topBar = (title?: string) => (
    <div className="fln-plan-top">
      <button type="button" className="fln-back" aria-label={s.back} onClick={goBack}>
        <span aria-hidden="true">{rtl ? '›' : '‹'}</span>
      </button>
      {title ? <span className="fln-plan-top-title"><Chrome text={title} rtl={rtl} /></span> : null}
    </div>
  );

  if (load.state === 'loading') {
    return (
      <div className={`fln-plan${shareClass}`} aria-busy="true">
        {topBar()}
        <div className="fln-plan-skel fln-plan-header" aria-label={s.errors.loading}>
          <div className="fln-skel-line" /><div className="fln-skel-line" /><div className="fln-skel-line fln-skel-line--title" />
        </div>
        {[0, 1, 2, 3].map((i) => <div key={i} className="fln-skel-sec" />)}
      </div>
    );
  }

  if (load.state === 'missing') {
    return (
      <div className={`fln-plan fln-plan--empty${shareClass}`}>
        {topBar()}
        <p className="fln-plan-msg"><Chrome text={s.errors.notAvailable} rtl={rtl} /></p>
        <button type="button" className="fln-btn" onClick={() => navigate(LESSONS_HOME)}>{s.errors.toList}</button>
      </div>
    );
  }

  if (load.state === 'unavailable') {
    return (
      <div className={`fln-plan fln-plan--empty${shareClass}`}>
        {topBar()}
        <p className="fln-plan-msg"><Chrome text={s.errors.unavailable} rtl={rtl} /></p>
        <button type="button" className="fln-btn" onClick={() => setAttempt((a) => a + 1)}>{s.errors.retry}</button>
      </div>
    );
  }

  const p = load.data.plan;
  const first = placement[0];
  const homeworkIndex = p.sections.length;
  return (
    <FlnPlayerProvider player={player}>
      <div className={`fln-plan${shareClass}`}>
        {topBar(s.subject[p.subject])}
        <Header plan={p} placement={first} uiLang={lang} />
        <Details plan={p} uiLang={lang} />
        <TimeBar plan={p} uiLang={lang} />
        {hasGrid ? (
          <div className="fln-grid-box">
            <h3 className="fln-grid-h"><span aria-hidden="true">🔊 </span><Chrome text={s.soundsInLesson} rtl={rtl} /></h3>
            <SoundGrid plan={p} screener={screener} />
          </div>
        ) : null}
        {p.sections.map((sec, i) => (
          <Section
            key={`${sec.kind}-${i}`}
            plan={p}
            index={i}
            kind={sec.kind}
            minutes={sec.minutes ?? p.minutes[sec.kind]}
            groups={sec.groups}
            open={open.has(i)}
            onToggle={toggle}
            uiLang={lang}
          />
        ))}
        {p.homework?.length ? (
          <Section
            plan={p}
            index={homeworkIndex}
            kind="homework"
            groups={[{ header: null, level: null, items: p.homework }]}
            open={open.has(homeworkIndex)}
            onToggle={toggle}
            uiLang={lang}
          />
        ) : null}
        <p className="fln-plan-foot"><Chrome text={p.programme === 'p23' ? s.footer.p23(p.id) : s.footer.p25(p.id)} rtl={rtl} /></p>
        {me.share ? null /* m-links PR-D: <ShareBar …/> */ : null}
      </div>
    </FlnPlayerProvider>
  );
}

/** The routed page: who is looking and the chrome language come from FlnGate's context (`/me`, fetched per mount). */
export default function PlanPage() {
  const { me, lang } = useFln();
  return <PlanScreen me={me} lang={lang} />;
}
